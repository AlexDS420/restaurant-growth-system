// Restaurant OS — entitlements centralizados (blueprint §7.5): planes, features, trial, overrides
import { nowISO } from './db.js';

export const DEFAULT_FEATURES = {
  starter: {
    'menu.products.max': 50, 'orders.enabled': false, 'orders.whatsapp.enabled': false,
    'orders.realtime.enabled': false, 'delivery.enabled': false, 'delivery.zones.max': 0,
    'promotions.enabled': false, 'coupons.enabled': false, 'customers.enabled': false,
    'customers.crm.level': 'basic', 'reviews.enabled': false, 'reviews.google_link.enabled': false,
    'reviews.points.max': 0, 'reviews.requests.manual.enabled': false,
    'reviews.requests.automatic.enabled': false, 'reservations.enabled': false,
    'analytics.level': 'basic', 'staff.max': 1, 'payments.online.enabled': false,
    'reviews.google_sync.enabled': false, 'reviews.google_reply.enabled': false,
  },
  plus: {
    'menu.products.max': -1, 'orders.enabled': true, 'orders.whatsapp.enabled': true,
    'orders.realtime.enabled': false, 'delivery.enabled': true, 'delivery.zones.max': 3,
    'promotions.enabled': true, 'coupons.enabled': true, 'customers.enabled': true,
    'customers.crm.level': 'basic', 'reviews.enabled': true, 'reviews.google_link.enabled': true,
    'reviews.points.max': 5, 'reviews.requests.manual.enabled': true,
    'reviews.requests.automatic.enabled': false, 'reservations.enabled': false,
    'analytics.level': 'basic', 'staff.max': 3, 'payments.online.enabled': false,
    'reviews.google_sync.enabled': false, 'reviews.google_reply.enabled': false,
  },
  pro: {
    'menu.products.max': -1, 'orders.enabled': true, 'orders.whatsapp.enabled': true,
    'orders.realtime.enabled': true, 'delivery.enabled': true, 'delivery.zones.max': -1,
    'promotions.enabled': true, 'coupons.enabled': true, 'customers.enabled': true,
    'customers.crm.level': 'advanced', 'reviews.enabled': true, 'reviews.google_link.enabled': true,
    'reviews.points.max': -1, 'reviews.requests.manual.enabled': true,
    'reviews.requests.automatic.enabled': true, 'reservations.enabled': true,
    'analytics.level': 'advanced', 'staff.max': -1, 'payments.online.enabled': true,
    'reviews.google_sync.enabled': true, 'reviews.google_reply.enabled': true,
  },
};

export const PLAN_ORDER = ['starter', 'plus', 'pro'];

// Aplica trial vencido: Pro trial → Starter (sin borrar datos; premium read-only) (blueprint §7.6)
export function checkTrial(db, venueId) {
  const sub = db.prepare(`SELECT * FROM subscriptions WHERE venue_id = ? AND status IN ('trialing','active') ORDER BY id DESC LIMIT 1`).get(venueId);
  if (sub && sub.status === 'trialing' && sub.trial_ends_at && sub.trial_ends_at < nowISO()) {
    db.prepare(`UPDATE subscriptions SET status='expired', plan_id='starter', updated_at=? WHERE id=?`).run(nowISO(), sub.id);
    db.prepare(`INSERT INTO subscription_events (subscription_id, venue_id, event_type, payload_json) VALUES (?,?,?,?)`)
      .run(sub.id, venueId, 'trial_expired', JSON.stringify({ from: sub.plan_id, to: 'starter' }));
    audit(db, { venueId, action: 'subscription.trial_expired', entityType: 'subscription', entityId: sub.id, before: { plan: sub.plan_id }, after: { plan: 'starter' } });
    return { downgraded: true, plan: 'starter' };
  }
  return { downgraded: false, plan: sub?.plan_id ?? 'starter' };
}

export function currentPlan(db, venueId) {
  return db.prepare(`SELECT plan_id AS plan FROM subscriptions WHERE venue_id = ? AND status IN ('trialing','active') ORDER BY id DESC LIMIT 1`).get(venueId)?.plan ?? 'starter';
}

// Valor de un feature para un venue (plan base + overrides de plataforma)
export function feature(db, venueId, key) {
  const plan = currentPlan(db, venueId);
  let value = DEFAULT_FEATURES[plan]?.[key];
  if (value === undefined) value = DEFAULT_FEATURES.starter[key];
  const ov = db.prepare(`SELECT value FROM organization_feature_overrides WHERE venue_id = ? AND feature_key = ?`).get(venueId, key);
  if (ov) {
    const n = Number(ov.value);
    value = Number.isNaN(n) ? ov.value : n;
  }
  return value;
}

export function featuresOf(db, venueId) {
  const plan = currentPlan(db, venueId);
  const out = { plan };
  const base = { ...DEFAULT_FEATURES.starter, ...DEFAULT_FEATURES[plan] };
  for (const [k, v] of Object.entries(base)) out[k] = v;
  for (const ov of db.prepare('SELECT feature_key, value FROM organization_feature_overrides WHERE venue_id = ?').all(venueId)) {
    const n = Number(ov.value);
    out[ov.feature_key] = Number.isNaN(n) ? ov.value : n;
  }
  return out;
}

export function enforceCount(db, venueId, key, currentCount) {
  const max = feature(db, venueId, key);
  if (max !== -1 && currentCount >= max) {
    const e = new Error(`Alcanzaste el límite de tu plan (${max}).`);
    e.code = 'PLAN_LIMIT';
    throw e;
  }
}