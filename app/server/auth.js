// Restaurant OS — autenticación y autorización (scrypt, sesiones httpOnly, RBAC)
import { scryptSync, timingSafeEqual, createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { nowISO, secureToken } from './db.js';

// ---- contraseñas (scrypt) ----
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `s3:${salt}:${hash}`;
}
export function verifyPassword(password, stored) {
  try {
    const [, salt, hash] = stored.split(':');
    const derived = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
    const expected = Buffer.from(hash, 'hex');
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch { return false; }
}

// ---- sesiones ----
export function createSession(db, userId, ttlDays = config.sessionTtlDays) {
  const token = secureToken(32);
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + ttlDays * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)').run(tokenHash, userId, expires);
  return token;
}
export function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}
function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }

export function userFromRequest(db, req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)ros_session=([^;]+)/);
  if (!m) return null;
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(hashToken(decodeURIComponent(m[1])), nowISO());
  if (!row) return null;
  row.password_hash = undefined; // nunca serializar
  return row;
}

// ---- RBAC (security-spec A) ----
export const PERMISSIONS = [
  'venue.manage', 'menu.read', 'menu.products.write', 'orders.read', 'orders.transition', 'orders.refund',
  'payments.read', 'payments.update', 'billing.manage', 'billing.cancel', 'team.manage',
  'customers.read', 'customers.export', 'customers.write', 'reviews.read', 'reviews.manage',
  'analytics.read', 'reservations.read', 'reservations.manage', 'promotions.write', 'coupons.write',
  'inventory.manage', 'audit.read', 'admin.manage',
];

const ALL = PERMISSIONS.filter((p) => p !== 'admin.manage');
export const ROLE_PERMISSIONS = {
  platform_admin: [...PERMISSIONS],
  owner: [...ALL],
  manager: ALL.filter((p) => !['billing.cancel', 'team.manage', 'customers.export'].includes(p)),
  kitchen: ['menu.read', 'orders.read', 'orders.transition'],
  cashier: ['menu.read', 'orders.read', 'orders.transition', 'payments.read', 'payments.update', 'customers.read'],
  marketing: ['menu.read', 'menu.products.write', 'promotions.write', 'coupons.write', 'reviews.read', 'reviews.manage', 'customers.read', 'analytics.read'],
  viewer: ['menu.read', 'orders.read', 'reviews.read', 'analytics.read', 'customers.read'],
  customer: [],
};

export function can(role, perm) { return ROLE_PERMISSIONS[role]?.includes(perm) || false; }

// ---- middlewares ----
export function requireAuth(db) {
  return (req, res, next) => {
    const user = userFromRequest(db, req);
    if (!user) return sendError(res, 401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
    req.user = user;
    next();
  };
}
export function requirePerm(db, perm) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
    if (!can(req.user.role, perm)) return sendError(res, 403, 'FORBIDDEN', 'No tienes permiso para esta acción.');
    next();
  };
}

export function sendError(res, status, code, message) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: false, error: { code, message } }));
}
export function sendOk(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: true, data }));
}