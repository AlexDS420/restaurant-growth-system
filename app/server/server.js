// Restaurant OS — servidor HTTP: enrutador, body parser, rate limit, estáticos, métricas, operativos
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, publicDir } from './config.js';
import { openDb, nowISO } from './db.js';
import { sendError, sendOk } from './auth.js';
import { apiMetrics } from './orders.js';
import { startOutboxWorker } from './notifications.js';
import { registerPublicRoutes } from './routes-public.js';
import { registerAppRoutes } from './routes-app.js';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

export async function startServer({ port = config.port, seedDemo = config.seedDemo } = {}) {
  const db = openDb();
  const fresh = db.prepare('SELECT COUNT(*) n FROM venues').get().n === 0;
  if (fresh && seedDemo) {
    const { seed } = await import('./seed.js');
    await seed(db);
    console.log('[seed] datos demo creados');
  }
  const outboxTimer = startOutboxWorker(db);
  let ready = false;

  // --- router ---
  const routes = []; // [method, regex, keys, handler]
  const compose = (handlers) => (req, res) => {
    let i = 0;
    const next = () => { const h = handlers[++i]; if (h) return h(req, res, next); };
    return handlers[0](req, res, next);
  };
  const routeReg = (method) => (pattern, ...handlers) => {
    handlers = handlers.flat();
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
    routes.push([method, regex, keys, handlers.length === 1 ? handlers[0] : compose(handlers)]);
  };
  const app = { db };
  app.get = routeReg('GET'); app.post = routeReg('POST'); app.patch = routeReg('PATCH'); app.delete = routeReg('DELETE');

  if (!app._mounted) {
    app._mounted = true;
    registerPublicRoutes(app);
    registerAppRoutes(app);
  }

  // --- rate limit (ventana fija en memoria) ---
  const buckets = new Map();
  function rateLimit(key, limit, windowMs) {
    if (!config.rateLimitEnabled) return true;
    const now = Date.now();
    const b = buckets.get(key) || { hits: 0, resetAt: now + windowMs };
    if (now > b.resetAt) { b.hits = 0; b.resetAt = now + windowMs; }
    b.hits++;
    buckets.set(key, b);
    return b.hits <= limit;
  }

  const server = createServer(async (req, res) => {
    const started = Date.now();
    let pathname = '(ruta inválida)';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'");
    if (config.env === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      try { pathname = decodeURIComponent(url.pathname); }
      catch { return sendError(res, 400, 'INVALID_URI', 'La ruta solicitada no es válida.'); }
      req.query = Object.fromEntries(url.searchParams);
      req.ip = config.trustProxy
        ? (req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1')
        : (req.socket.remoteAddress || '127.0.0.1');
      if (pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');

      if (['POST', 'PATCH', 'PUT'].includes(req.method) && pathname.startsWith('/api/')) {
        const chunks = [];
        let size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 2 * 1024 * 1024) return sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'La solicitud es demasiado grande.');
          chunks.push(c);
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) req.body = {};
        else {
          try { req.body = JSON.parse(raw); }
          catch { return sendError(res, 400, 'INVALID_JSON', 'El cuerpo JSON no es válido.'); }
        }
      } else {
        req.body = {};
      }

      // rate limits
      if (pathname.startsWith('/api/v1/public/')) {
        const lim = pathname.includes('/orders') ? 10 : 60;
        if (!rateLimit(`pub:${req.ip}`, lim, 60000)) return sendError(res, 429, 'RATE_LIMITED', 'Demasiadas solicitudes. Espera un momento.');
      }
      if (pathname === '/api/v1/auth/login' && !rateLimit(`login:${req.ip}`, 10, 15 * 60000)) {
        return sendError(res, 429, 'RATE_LIMITED', 'Demasiados intentos. Espera 15 minutos.');
      }

      if (pathname.startsWith('/api/') || pathname.startsWith('/r/')) {
        for (const [method, pattern, keys, handler] of routes) {
          if (method !== req.method) continue;
          const m = pathname.match(pattern);
          if (!m) continue;
          req.params = {};
          keys.forEach((k, i) => { req.params[k] = m[i + 1]; });
          return await handler(req, res);
        }
        return sendError(res, 404, 'NOT_FOUND', 'Ruta no encontrada.');
      }

      if (pathname === '/') return await serveFile(res, 'index.html');
      return await serveFile(res, pathname.slice(1));
    } catch (e) {
      console.error('[http]', req.method, pathname, e.message);
      if (!res.writableEnded) sendError(res, 500, 'INTERNAL', 'Error interno. Intenta nuevamente.');
    } finally {
      apiMetrics.recordLatency(Date.now() - started);
    }
  });

  async function serveFile(res, rel) {
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    try {
      const data = await readFile(join(publicDir, safe));
      res.writeHead(200, { 'Content-Type': MIME[extname(safe)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      return res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
  }

  // operativos
  app.get('/api/v1/healthz', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      sendOk(res, { status: 'ok', time: nowISO(), uptime_s: Math.round(process.uptime()), env: config.env });
    } catch { sendError(res, 503, 'DEGRADED', 'Base de datos no disponible.'); }
  });
  app.get('/api/v1/readyz', (_req, res) => {
    if (!ready) return sendError(res, 503, 'NOT_READY', 'El servidor aún está iniciando.');
    try {
      db.prepare('SELECT 1').get();
      sendOk(res, { status: 'ready', time: nowISO(), uptime_s: Math.round(process.uptime()) });
    } catch { sendError(res, 503, 'DEGRADED', 'Base de datos no disponible.'); }
  });
  app.get('/api/v1/metrics', (_req, res) => sendOk(res, apiMetrics.snapshot()));

  return new Promise((resolve) => {
    server.listen(port, () => {
      ready = true;
      console.log(`[server] Restaurant OS escuchando en http://localhost:${port} (${config.env})`);
      let closing;
      const close = () => {
        if (closing) return closing;
        ready = false;
        outboxTimer.stop?.();
        closing = new Promise((done) => server.close(() => {
          try { db.close(); } finally { done(); }
        }));
        return closing;
      };
      resolve({ server, db, app, port, close });
    });
  });
}

const isMain = Boolean(process.argv[1]) && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  let instance;
  const shutdown = async (signal) => {
    console.log(`[server] ${signal}: cerrando conexiones...`);
    try { await instance?.close?.(); process.exit(0); }
    catch (e) { console.error('[server] error al cerrar:', e.message); process.exit(1); }
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  startServer().then((running) => { instance = running; })
    .catch((e) => { console.error('[server] error de arranque:', e); process.exit(1); });
}
