// Restaurant OS — capa de base de datos: apertura, migraciones, transacciones, auditoría
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config, rootDir } from './config.js';

export function openDb() {
  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`);
  const dir = path.join(rootDir, 'server', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const done = new Set(db.prepare('SELECT version FROM migrations').all().map((r) => r.version));
  for (const f of files) {
    const version = Number(f.match(/^(\d+)/)[1]);
    if (done.has(version)) continue;
    db.exec(readFileSync(path.join(dir, f), 'utf8'));
    db.prepare('INSERT INTO migrations (version) VALUES (?)').run(version);
    console.log(`[db] migración ${f} aplicada`);
  }
}

export const nowISO = () => new Date().toISOString();
export const uuid = () => randomUUID();
export const secureToken = (bytes = 32) => randomBytes(bytes).toString('hex');

export function withTxn(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ya terminó */ }
    throw e;
  }
}

export async function withTxnAsync(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = await fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ya terminó */ }
    throw e;
  }
}

export function audit(db, { venueId = null, user = null, action, entityType, entityId, before, after, ip = null }) {
  db.prepare(`INSERT INTO audit_logs (venue_id, user_id, user_email, role, action, entity_type, entity_id, before_json, after_json, ip)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    venueId, user?.id ?? null, user?.email ?? null, user?.role ?? null, action, entityType,
    entityId == null ? null : String(entityId),
    before === undefined ? null : JSON.stringify(before),
    after === undefined ? null : JSON.stringify(after),
    ip ?? null,
  );
}

export function analyticsEvent(db, { venueId, sessionId = null, eventName, actorType = 'system', entityType = null, entityId = null, properties = {} }) {
  db.prepare(`INSERT INTO analytics_events (venue_id, session_id, event_name, actor_type, entity_type, entity_id, properties_json)
    VALUES (?,?,?,?,?,?,?)`).run(
    venueId, sessionId, eventName, actorType, entityType, entityId == null ? null : String(entityId), JSON.stringify(properties));
}

export function jparse(s, fallback = null) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}