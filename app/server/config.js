// Restaurant OS — configuración central (variables de entorno con defaults seguros)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Carga .env si existe (formato simplificado KEY=value)
const envFile = path.join(__dirname, '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : String(v).toLowerCase() === 'true');
const runtimeEnv = process.env.NODE_ENV || 'development';

export const config = {
  env: runtimeEnv,
  port: num(process.env.PORT, 3000),
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'restaurant-os.db'),
  sessionTtlDays: num(process.env.SESSION_TTL_DAYS, 7),
  paymentsMode: process.env.PAYMENTS_MODE || 'mock',
  paymentsFailMode: process.env.PAYMENTS_FAIL_MODE || 'none', // none | decline | outage
  rateLimitEnabled: bool(process.env.RATE_LIMIT_ENABLED, true),
  // Los datos demo y las credenciales conocidas nunca se crean por defecto.
  // El desarrollo debe pedirlos explícitamente con SEED_DEMO=true / npm run seed.
  seedDemo: bool(process.env.SEED_DEMO, false),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  outboxIntervalMs: num(process.env.OUTBOX_INTERVAL_MS, 5000),
  outboxMaxAttempts: num(process.env.OUTBOX_MAX_ATTEMPTS, 5),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@restaurantos.pe',
  logLevel: process.env.LOG_LEVEL || 'info',
};

export const rootDir = path.join(__dirname, '..');
export const publicDir = path.join(rootDir, 'public');
