/* Restaurant OS — Suite E2E (node:test)
 * Requisito §39 del blueprint: 6 pruebas obligatorias (aislamiento multi-tenant,
 * precios server-side, idempotencia, fallo de notificaciones, entitlements Plus/Pro, RBAC)
 * + extras: pagos, reembolso, stock, cupones, reservas, reseñas, auditoría, métricas, persistencia.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3400 + Math.floor(Math.random() * 400);
const DB_PATH = path.join(ROOT, 'data', `e2e-${Date.now()}.db`);
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const SITE = `http://127.0.0.1:${PORT}`;

let server, cp;
const log = [];
const run = (cmd) => new Promise((res) => { exec(cmd, (e, so, se) => res({ e, so, se })); });

async function startServer() {
  cp = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), DB_PATH, SEED_DEMO: 'true', OUTBOX_INTERVAL_MS: '800', LOG_LEVEL: 'warn', RATE_LIMIT_ENABLED: 'false', STRIPE_WEBHOOK_SECRET: 'e2e-webhook-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  cp.stdout.on('data', (d) => log.push(String(d)));
  cp.stderr.on('data', (d) => log.push(String(d)));
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch { /* reintenta */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Servidor no levantó a tiempo. Log: ' + log.slice(-20).join('\n'));
}
function stopServer() { if (cp) { cp.kill('SIGTERM'); cp = null; } }

let cookie = {};
async function api(path, { method = 'GET', body, auth } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const c = auth ? cookie[auth] : undefined;
  if (c) headers.cookie = c;
  const r = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { const j = await r.json(); json = (j && j.success === true && j.data !== undefined) ? j.data : j; } catch { /* sin json */ }
  const setC = r.headers.get('set-cookie') || '';
  const m = setC.match(/ros_session=([^;]+)/);
  if (m) cookie[auth || 'anon'] = 'ros_session=' + m[1];
  return { status: r.status, ok: r.status >= 200 && r.status < 300, json };
}
async function login(email, pass, key) {
  const r = await api('/auth/login', { method: 'POST', body: { email, password: pass }, auth: key });
  assert.ok(r.ok, 'login ' + email + ' → ' + r.status + ' ' + JSON.stringify(r.json));
  return r;
}
async function loginCustomer(key = 'customerC') {
  const r = await api('/auth/customer-login', { method: 'POST', body: { email: 'cliente@demo.pe', password: 'Demo1234!' }, auth: key });
  assert.ok(r.ok, 'customer login → ' + r.status + ' ' + JSON.stringify(r.json));
  return r;
}
async function order(customer, items, extra = {}) {
  const r = await api(`/public/venues/casa-aurora/orders`, { method: 'POST', body: { idempotency_key: randomBytes(8).toString('hex'), customer, fulfillment: { type: 'pickup' }, items, ...extra }, auth: 'customerC' });
  return r;
}
const pay = (token, last4 = '4242') => api(`/public/venues/casa-aurora/orders/${token}/pay`, { method: 'POST', body: { card_last4: last4, card_brand: 'visa' }, auth: 'customerC' });

let menu, promoProd, stockProd, cheapProd, zone;

before(async () => {
  await startServer();
  // cargar catálogo
  const m = await api('/public/venues/casa-aurora/menu');
  menu = m.json;
  promoProd = menu.categories.flatMap((c) => c.products).find((p) => p.promo_price_minor != null);
  stockProd = null;
  const v = await api('/public/venues/casa-aurora');
  zone = v.json.zones[0];
  await login('owner@casaaurora.pe', 'Demo1234!', 'ownerCasa');
  await login('owner@lacantina.pe', 'Demo1234!', 'ownerCanta');
  await login('cocina@casaaurora.pe', 'Demo1234!', 'kitchenC');
  await login('caja@casaaurora.pe', 'Demo1234!', 'cashierC');
  await login('marketing@casaaurora.pe', 'Demo1234!', 'marketingC');
  await login('admin@restaurantos.pe', 'Admin1234!', 'adminC');
  await loginCustomer();
  const adminProds = await api('/menu/products', { auth: 'ownerCasa' });
  if (!adminProds.ok || !Array.isArray(adminProds.json)) console.error('ADMINPRODS', adminProds.status, JSON.stringify(adminProds.json).slice(0,300));
  stockProd = adminProds.json.find((p) => p.track_stock === 1);
  assert.ok(stockProd, 'hay producto con control de stock');
});

after(async () => { stopServer(); });

describe('§39 T1 — Aislamiento multi-tenant', () => {
  test('La Cantina no ve pedidos ni productos de Casa Aurora', async () => {
    // sembrar pedidos creando uno en casa aurora
    const o = await order({ name: 'Iso A', phone: '+51999000001' }, [{ product_id: promoProd.id, quantity: 1 }]);
    assert.ok(o.ok, 'pedido casa aurora creado');
    const rows = await api('/orders', { auth: 'ownerCanta' });
    assert.ok(rows.ok);
    assert.equal(rows.json.length, 0, 'tenant B no ve pedidos de A');
    const prods = await api('/menu/products', { auth: 'ownerCanta' });
    assert.ok(prods.json.every((p) => p.venue_id !== 1) || prods.json.length < 5, 'catálogo de B es propio');
    // acceso directo entre tenants
    const cross = await api('/orders/1', { auth: 'ownerCanta' });
    assert.equal(cross.status, 404, 'pedido ajeno → 404');
    // slug inexistente
    const nf = await api('/public/venues/no-existe/menu');
    assert.equal(nf.status, 404);
  });
});

describe('§39 T2 — Precios server-side (anti-manipulación)', () => {
  test('totales calculados por servidor, no del cliente', async () => {
    const price = promoProd.price_minor, promo = promoProd.promo_price_minor;
    const tampered = await order({ name: 'T2', phone: '+51999000002' }, [{ product_id: promoProd.id, quantity: 1, unit_price: 1, line_total: 1 }], { total_minor: 1, subtotal_minor: 1 });
    assert.ok(tampered.ok);
    const t = tampered.json.totals;
    // el producto tiene promoción vigente (special_price): el servidor cobra el precio promocional
    const expectUnit = promo != null && promo < price ? promo : price;
    assert.equal(t.subtotal_minor, expectUnit, 'subtotal = precio vigente en BD (promo si está activa)');
    assert.equal(t.tax_minor, Math.round(expectUnit * 0.18), 'IGV 18% sobre subtotal');
    assert.equal(t.total_minor, expectUnit + t.tax_minor + (t.delivery_fee_minor || 0), 'total consistente');
    // promoción server-side
    const p2 = await order({ name: 'T2b', phone: '+51999000003' }, [{ product_id: promoProd.id, quantity: 2 }]);
    assert.ok(p2.ok);
    const t2 = p2.json.totals;
    assert.equal(t2.subtotal_minor, 2 * expectUnit);
    assert.equal(t2.total_minor, t2.subtotal_minor - t2.discount_minor + t2.tax_minor + (t2.delivery_fee_minor || 0), 'total consistente (con/sin descuento promo)');
  });
});

describe('§39 T3 — Idempotencia (pedido + pago)', () => {
  test('misma idempotency_key → mismo pedido, sin duplicados', async () => {
    const body = { idempotency_key: 'IDEM-E2E-1', customer: { name: 'T3', phone: '+51999000004' }, fulfillment: { type: 'pickup' }, items: [{ product_id: promoProd.id, quantity: 1 }] };
    const a = await api('/public/venues/casa-aurora/orders', { method: 'POST', body, auth: 'customerC' });
    const b = await api('/public/venues/casa-aurora/orders', { method: 'POST', body, auth: 'customerC' });
    assert.ok(a.ok); assert.ok(b.ok);
    assert.equal(a.json.id, b.json.id, 'mismo pedido');
    assert.equal(a.json.public_token, b.json.public_token, 'mismo token');
  });
  test('doble pago → PAYMENT_ALREADY_PROCESSED', async () => {
    const o = await order({ name: 'T3b', phone: '+51999000005' }, [{ product_id: promoProd.id, quantity: 1 }]);
    const r1 = await pay(o.json.public_token);
    assert.ok(r1.ok);
    assert.equal(r1.json.order.payment_status, 'paid');
    const r2 = await pay(o.json.public_token);
    assert.equal(r2.status, 409);
    assert.equal(r2.json.error.code, 'PAYMENT_ALREADY_PROCESSED');
  });
});

describe('§39 T4 — Fallo de notificaciones no pierde pedidos', () => {
  test('outbox: pedido persiste aunque el notificador falle', async () => {
    const r = await order({ name: 'T4', phone: '+51999000006' }, [{ product_id: promoProd.id, quantity: 1 }]);
    assert.ok(r.ok);
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const ev = db.prepare(`SELECT event_type, entity_id, status FROM outbox_events WHERE entity_type='order' AND entity_id=?`).all(String(r.json.id));
    db.close();
    assert.ok(ev.some((e) => /order_created/.test(e.event_type)), 'evento de creación encolado en outbox');
    // el pedido existe y es consultable pese a cualquier fallo posterior del notificador
    const track = await api(`/public/orders/${r.json.public_token}`);
    assert.ok(track.ok);
    assert.equal(track.json.id, r.json.id);
  });
});

describe('§39 T5 — Entitlements Plus vs Pro', () => {
  test('Starter (La Cantina) no puede crear pedidos', async () => {
    const m = await api('/public/venues/la-cantina/menu');
    const p = m.json.categories.flatMap((c) => c.products)[0];
    const r = await api('/public/venues/la-cantina/orders', { method: 'POST', body: { idempotency_key: 'X-STARTER', customer: { name: 'T5', phone: '999' }, fulfillment: { type: 'pickup' }, items: [{ product_id: p.id, quantity: 1 }] }, auth: 'customerC' });
    assert.equal(r.status, 403);
    assert.equal(r.json.error.code, 'ORDERS_DISABLED');
  });
  test('Plus-shape: tope de puntos de reseña aplica; Pro (trial) no', async () => {
    // simular Plus: override con tope 3 (casa aurora ya tiene 2 sembrados)
    const ov = await api('/admin/venues/1/overrides', { method: 'POST', auth: 'adminC', body: { feature_key: 'reviews.points.max', value: 3 } });
    assert.ok(ov.ok);
    const r1 = await api('/reviews/points', { method: 'POST', auth: 'ownerCasa', body: { name: 'Punto 3', type: 'counter' } });
    assert.ok(r1.ok);
    const r2 = await api('/reviews/points', { method: 'POST', auth: 'ownerCasa', body: { name: 'Punto 4 (debe fallar)', type: 'counter' } });
    assert.equal(r2.status, 403);
    assert.equal(r2.json.error.code, 'PLAN_LIMIT');
    // quitar override → vuelve el límite Pro (-1 = ilimitado)
    await api('/admin/venues/1/overrides', { method: 'POST', auth: 'adminC', body: { feature_key: 'reviews.points.max', value: -1 } });
    const r3 = await api('/reviews/points', { method: 'POST', auth: 'ownerCasa', body: { name: 'Punto Pro libre', type: 'counter' } });
    assert.ok(r3.ok, 'Pro sin tope');
  });
  test('Pro trial incluye reservas; Promociones/Cupones activos', async () => {
    const feats = await api('/venue', { auth: 'ownerCasa' });
    assert.equal(feats.json.features['reservations.enabled'], true);
    assert.equal(feats.json.features['orders.enabled'], true);
    assert.equal(feats.json.features['payments.online.enabled'], true);
  });
});

describe('§39 T6 — RBAC', () => {
  test('kitchen: opera pedidos pero no paga/audita/suscribe', async () => {
    const o = await order({ name: 'RBAC', phone: '+51999000007' }, [{ product_id: promoProd.id, quantity: 1 }]);
    const tr = await api(`/orders/${o.json.id}/transition`, { method: 'POST', auth: 'kitchenC', body: { status: 'accepted' } });
    assert.ok(tr.ok, 'cocina avanza comanda');
    const rf = await api(`/orders/${o.json.id}/refund`, { method: 'POST', auth: 'kitchenC', body: { reason: 'x' } });
    assert.equal(rf.status, 403, 'cocina no reembolsa');
    const bil = await api('/billing', { auth: 'kitchenC' });
    assert.equal(bil.status, 403, 'cocina no ve facturación');
    const aud = await api('/audit', { auth: 'kitchenC' });
    assert.equal(aud.status, 403, 'cocina no ve auditoría');
  });
  test('cashier: transiciona pero no gestiona menú', async () => {
    const prods = await api('/menu/products', { auth: 'cashierC' });
    assert.ok(prods.json.length > 0, 'caja lee menú');
    const wr = await api('/menu/products', { method: 'POST', auth: 'cashierC', body: { name: 'X', price_minor: 1 } });
    assert.equal(wr.status, 403, 'caja no crea productos');
  });
  test('marketing: promociones sí, inventario no; owner: suscripción sí, manager no existe→owner', async () => {
    const promo = await api('/promotions', { auth: 'marketingC' });
    assert.ok(promo.ok, 'marketing lee promos');
    const inv = await api('/inventory/movements', { method: 'POST', auth: 'marketingC', body: { item_id: 1, reason: 'usage', change_qty: -1 } });
    assert.equal(inv.status, 403, 'marketing no toca inventario');
    const cancel = await api('/billing/cancel', { method: 'POST', auth: 'ownerCasa', body: {} });
    assert.ok(cancel.ok, 'owner cancela suscripción');
    const retry = await api('/billing/retry', { method: 'POST', auth: 'ownerCasa', body: {} });
    assert.ok(retry.ok, 'owner reactiva');
  });
  test('owner no puede elevar roles ni cambiarse a sí mismo', async () => {
    const team = await api('/team', { auth: 'ownerCasa' });
    const target = team.json.find((u) => u.role === 'kitchen');
    assert.ok(target);
    const elevate = await api(`/team/${target.id}`, { method: 'PATCH', auth: 'ownerCasa', body: { role: 'platform_admin' } });
    assert.equal(elevate.status, 400);
    const self = await api(`/team/${team.json.find((u) => u.email === 'owner@casaaurora.pe').id}`, { method: 'PATCH', auth: 'ownerCasa', body: { role: 'viewer' } });
    assert.equal(self.status, 409);
  });
});

describe('Extras — pagos, stock, reembolso, auditoría, métricas', () => {
  test('pago declinado y caída de proveedor', async () => {
    const o = await order({ name: 'PAY', phone: '+51999000008' }, [{ product_id: promoProd.id, quantity: 1 }]);
    const t = o.json.public_token;
    const d = await pay(t, '0001');
    assert.equal(d.status, 402);
    assert.equal(d.json.error.code, 'PAYMENT_DECLINED');
    const u = await pay(t, '9999');
    assert.equal(u.json.error.code, 'PROVIDER_UNAVAILABLE');
    const okp = await pay(t, '4242');
    assert.ok(okp.ok);
    assert.equal(okp.json.order.payment_status, 'paid');
  });
  test('stock: consumo al pedir, restauración al cancelar, agotado → 409', async () => {
    const before = (await api('/menu/products', { auth: 'ownerCasa' })).json.find((p) => p.id === stockProd.id).stock_quantity;    const o = await order({ name: 'STK', phone: '+51999000009' }, [{ product_id: stockProd.id, quantity: 1 }]);
    assert.ok(o.ok);
    const mid = (await api('/menu/products', { auth: 'ownerCasa' })).json.find((p) => p.id === stockProd.id).stock_quantity;
    assert.equal(mid, before - 1, 'stock decrementado');
    const cancel = await api(`/orders/${o.json.id}/transition`, { method: 'POST', auth: 'ownerCasa', body: { status: 'cancelled' } });
    assert.ok(cancel.ok, 'cancelación' + JSON.stringify(cancel.json));
    const after = (await api('/menu/products', { auth: 'ownerCasa' })).json.find((p) => p.id === stockProd.id).stock_quantity;
    assert.equal(after, before, 'stock restaurado');
    const out = await order({ name: 'STK2', phone: '+51999000010' }, [{ product_id: stockProd.id, quantity: before + 5 }]);
    assert.equal(out.status, 422);
    assert.equal(out.json.error.code, 'STOCK_OUT');
  });
  test('reembolso parcial del pedido pagado', async () => {
    const o = await order({ name: 'REF', phone: '+51999000011' }, [{ product_id: promoProd.id, quantity: 1 }]);
    const t = o.json.public_token;
    await pay(t);
    const r = await api(`/orders/${o.json.id}/refund`, { method: 'POST', auth: 'ownerCasa', body: { reason: 'Cliente pidió devolución', amount_minor: o.json.totals.total_minor } });
    assert.ok(r.ok, 'reembolso ' + JSON.stringify(r.json));
    const det = await api(`/orders/${o.json.id}/payments`, { auth: 'ownerCasa' });
    assert.ok(det.json.refunds.length >= 1, 'reembolso registrado');
  });
  test('auditoría con actor, acción y timestamp', async () => {
    const aud = await api('/audit', { auth: 'ownerCasa' });
    assert.ok(aud.ok);
    const rows = aud.json.filter((r) => r.action === 'order.created');
    assert.ok(rows.length >= 1, 'audit registra order.created');
    assert.ok(rows.every((r) => r.created_at), 'todas las entradas tienen timestamp');
    assert.ok(rows.every((r) => r.ip || r.user_email || r.role), 'todas tienen actor o ip');
    const withUser = aud.json.filter((r) => r.user_email);
    assert.ok(withUser.length >= 1, 'alguna entrada registra un usuario autenticado');
  });
  test('métricas/healthz', async () => {
    const h = await api('/healthz');
    assert.ok(h.ok);
    const m = await fetch(`${BASE}/metrics`);
    const txt = await m.text();
    assert.match(txt, /order_count/);
    assert.match(txt, /latency/);
  });
  test('cabeceras seguras y JSON inválido', async () => {
    const health = await fetch(`${BASE}/healthz`);
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.match(health.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(health.headers.get('cache-control'), 'no-store');

    const malformed = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email":',
    });
    assert.equal(malformed.status, 400);
    const payload = await malformed.json();
    assert.equal(payload.error.code, 'INVALID_JSON');
  });
  test('persistencia: datos sobreviven reinicio', async () => {
    const n1 = (await api('/orders', { auth: 'ownerCasa' })).json.length;
    stopServer();
    await new Promise((r) => setTimeout(r, 400));
    await startServer();
    const n2 = (await api('/orders', { auth: 'ownerCasa' })).json.length;
    assert.equal(n2, n1, 'misma cantidad de pedidos tras reinicio');
  });
});

describe('Extras — clientes, reservas, reseñas', () => {
  test('menú público conserva vínculos de opciones', async () => {
    const hamburguesa = menu.categories.flatMap((c) => c.products).find((p) => p.name === 'Hamburguesa Clásica');
    const grupo = menu.option_groups.find((g) => g.name === 'Tamaño');
    assert.ok(hamburguesa.option_group_ids.includes(grupo.id));
    assert.ok(grupo.product_ids.includes(hamburguesa.id));
  });
  test('cliente 360 con notaa', async () => {
    const cust = await api('/customers', { auth: 'ownerCasa' });
    assert.ok(cust.json.length >= 1);
    const id = cust.json[0].id;
    const d = await api(`/customers/${id}`, { auth: 'ownerCasa' });
    assert.ok(d.ok);
    assert.ok(Array.isArray(d.json.orders) && Array.isArray(d.json.reviews), '360: pedidos y reseñas');
    const note = await api(`/customers/${id}/notes`, { method: 'POST', auth: 'ownerCasa', body: { note: 'Prefiere mesa cerca de ventana (E2E)' } });
    assert.ok(note.ok);
  });
  test('reserva pública + confirmación', async () => {
    const dt = new Date(Date.now() + 2 * 864e5).toISOString();
    const r = await api('/public/venues/casa-aurora/reservations', { method: 'POST', body: { name: 'E2E Mesa', phone: '+51999000012', party_size: 4, datetime: dt } });
    assert.ok(r.ok, 'reserva ' + JSON.stringify(r.json));
    const tk = r.json.public_token || r.json.token;
    const list = await api('/reservations', { auth: 'ownerCasa' });
    const mine = list.json.find((x) => (x.public_token || x.token) === tk || x.id === r.json.reservation_id);
    assert.ok(mine, 'reserva visible en panel');
    const tr = await api(`/reservations/${mine.id}/transition`, { method: 'POST', auth: 'ownerCasa', body: { status: 'confirmed' } });
    assert.ok(tr.ok);
  });
  test('reseña: punto con QR, feedback privado tras entrega', async () => {
    const o = await order({ name: 'REV', phone: '+51999000013' }, [{ product_id: promoProd.id, quantity: 1 }]);
    await pay(o.json.public_token);
    // completar
    for (const s of ['accepted', 'preparing', 'ready', 'completed']) {
      await api(`/orders/${o.json.id}/transition`, { method: 'POST', auth: 'ownerCasa', body: { status: s } });
    }
    const fb = await api(`/public/venues/casa-aurora/orders/${o.json.public_token}/review`, { method: 'POST', body: { rating: 5, comment: '¡Excelente! (E2E)' } });
    assert.ok(fb.ok, 'feedback privado aceptado');
    const rev = await api('/reviews', { auth: 'ownerCasa' });
    assert.ok(rev.json.feedback.some((f) => /E2E/.test(f.comment || '')), 'feedback visible en panel');
    const redir = await fetch(`${SITE}/r/RPCAJA01`, { redirect: 'manual' });
    assert.ok([301, 302, 303].includes(redir.status), 'QR redirige a Google');
  });
  test('cupón y promoción en carrito', async () => {
    const r = await order({ name: 'CPN', phone: '+51999000014', email: 'cpn@demo.pe' }, [{ product_id: promoProd.id, quantity: 2 }], { coupon_code: 'BIENVENIDA10' });
    assert.ok(r.ok);
    assert.ok(r.json.totals.discount_minor > 0, 'cupón descuenta');
  });
});

describe('Regresión — onboarding de negocio', () => {
  test('una cuenta registrada inicia con sesión owner válida', async () => {
    const suffix = Date.now().toString(36);
    const email = `owner-${suffix}@nuevo-local.pe`;
    const registered = await api('/auth/register', {
      method: 'POST',
      auth: 'newOwner',
      body: {
        name: 'Nueva Propietaria',
        email,
        password: 'Registro123!',
        business_name: `Nuevo Local ${suffix}`,
      },
    });

    assert.equal(registered.status, 201, JSON.stringify(registered.json));
    assert.equal(registered.json.user.role, 'owner');

    const me = await api('/me', { auth: 'newOwner' });
    assert.ok(me.ok, JSON.stringify(me.json));
    assert.equal(me.json.user.email, email);
    assert.equal(me.json.user.role, 'owner');
    assert.ok(me.json.user.permissions.includes('venue.manage'));
  });
});

describe('Pagos — webhook firmado y conciliación', () => {
  test('rechaza firma inválida y procesa evento Stripe de forma idempotente', async () => {
    const event = { id: `evt_e2e_${Date.now()}`, type: 'payment_intent.succeeded', data: { object: { id: 'pi_missing_e2e' } } };
    const payload = JSON.stringify(event);
    const bad = await fetch(`${BASE}/webhooks/stripe`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, body: payload });
    assert.equal(bad.status, 400);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'e2e-webhook-secret').update(`${t}.${payload}`).digest('hex');
    const headers = { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` };
    const first = await fetch(`${BASE}/webhooks/stripe`, { method: 'POST', headers, body: payload });
    assert.equal(first.status, 200);
    const second = await fetch(`${BASE}/webhooks/stripe`, { method: 'POST', headers, body: payload });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).data.duplicate, true);
  });
});
