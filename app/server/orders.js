// Restaurant OS — motor de pedidos (blueprint §16): secuencia de creación, máquina de estados, pagos, reembolsos
import { withTxn, withTxnAsync, nowISO, audit, analyticsEvent, secureToken } from './db.js';
import { feature, currentPlan, checkTrial } from './entitlements.js';
import { paymentProvider, paymentProviderName, ProviderOutageError } from './payments.js';
import { enqueueOutbox } from './notifications.js';
import { can } from './auth.js';

export const ORDER_STATUSES = ['pending', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];
export const TRANSITIONS = {
  pending: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
// roles que pueden ejecutar cada transición (kitchen/cashier acotados)
export const TRANSITION_ROLES = {
  'pending>accepted': ['owner', 'manager', 'kitchen', 'cashier'],
  'pending>cancelled': ['owner', 'manager'],
  'accepted>preparing': ['owner', 'manager', 'kitchen'],
  'accepted>cancelled': ['owner', 'manager'],
  'preparing>ready': ['owner', 'manager', 'kitchen'],
  'preparing>cancelled': ['owner', 'manager'],
  'ready>completed': ['owner', 'manager', 'cashier'],
  'ready>cancelled': ['owner', 'manager'],
};

export function normalizePhone(phone = '') {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 9 && digits.startsWith('9')) return '+51' + digits;
  if (digits.length === 11 && digits.startsWith('51')) return '+' + digits;
  if (digits.length === 12 && digits.startsWith('+')) return '+' + digits.slice(1);
  return digits ? '+' + digits : null;
}

export function parseHours(json) {
  try { return JSON.parse(json); } catch { return null; }
}
export function openNow(venue, at = new Date()) {
  const hours = parseHours(venue.opening_hours_json);
  if (!hours) return { open: true, reason: null };
  const day = at.getDay() === 0 ? 7 : at.getDay();
  const cur = at.getHours() * 60 + at.getMinutes();
  const range = hours[String(day)]?? hours[day];
  if (!range) return { open: false, reason: 'closed' };
  if (range.open == null) return { open: false, reason: 'closed' };
  const [oh, om] = range.open.split(':').map(Number);
  const [ch, cm] = range.close.split(':').map(Number);
  const o = oh * 60 + om, c = ch * 60 + cm;
  const openNowFlag = c > o ? (cur >= o && cur < c) : (cur >= o || cur < c);
  return { open: openNowFlag, reason: openNowFlag ? null : 'outside_hours' };
}

export function publicVenue(db, slug) {
  const v = db.prepare(`SELECT * FROM venues WHERE slug = ?`).get(slug);
  if (!v) return null;
  v.features = featuresFor(db, v.id);
  const t = checkTrial(db, v.id);
  v.plan = t.plan;
  const o = openNow(v);
  v.is_open = o.open;
  v.tax_rate_bps = v.tax_rate_bps ?? 1800;
  delete v.opening_hours_json;
  v.opening_hours = parseHoursByDay(v);
  return v;
}
function featuresFor(db, venueId) {
  const plan = currentPlan(db, venueId);
  const keys = ['orders.enabled', 'delivery.enabled', 'pickup.enabled', 'reviews.enabled', 'reviews.points.max', 'reservations.enabled'];
  const o = { plan };
  for (const k of keys) o[k] = feature(db, venueId, k);
  return o;
}
function parseHoursByDay(v) {
  const h = parseHours(v.opening_hours_json);
  if (!h) return null;
  return [...Array(7).keys()].map((i) => ({ day: i === 0 ? 7 : i, ...(h[String(i === 0 ? 7 : i)] ?? {}) }));
}

export function publicMenu(db, slug) {
  const v = db.prepare('SELECT id, name, slug FROM venues WHERE slug = ?').get(slug);
  if (!v) return null;
  const cats = db.prepare(`SELECT id, name, description, sort_order FROM menu_categories
    WHERE venue_id = ? AND is_visible = 1 AND deleted_at IS NULL ORDER BY sort_order, name`).all(v.id);
  const products = db.prepare(`SELECT p.*, c.name AS category_name FROM menu_products p
    JOIN menu_categories c ON c.id = p.category_id
    WHERE p.venue_id = ? AND p.is_visible = 1 AND p.is_available = 1 AND p.deleted_at IS NULL
      AND (p.track_stock = 0 OR p.stock_quantity > 0)
    ORDER BY p.sort_order, p.name`).all(v.id);
  const groups = db.prepare(`SELECT g.*, pg.product_id, o.id AS option_id, o.name AS option_name, o.price_minor AS option_price, o.is_available AS option_available, o.sort_order AS option_sort
    FROM option_groups g
    JOIN product_option_groups pg ON pg.option_group_id = g.id
    LEFT JOIN options o ON o.option_group_id = g.id
    WHERE g.venue_id = ?
    ORDER BY g.sort_order, o.sort_order`).all(v.id);
  const groupMap = new Map();
  for (const r of groups) {
    if (!groupMap.has(r.id)) groupMap.set(r.id, { id: r.id, name: r.name, is_required: r.is_required, selection_type: r.selection_type, min_selections: r.min_selections, max_selections: r.max_selections, options: [], product_ids: [] });
    const g = groupMap.get(r.id);
    if (!g.product_ids.includes(r.product_id) && r.product_id != null) g.product_ids.push(r.product_id);
    if (r.option_id != null && r.option_available) g.options.push({ id: r.option_id, name: r.option_name, price_minor: r.option_price });
  }
  const byProduct = new Map();
  for (const r of groups) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, []);
    if (!byProduct.get(r.product_id).includes(r.id)) byProduct.get(r.product_id).push(r.id);
  }
  const catMap = new Map();
  for (const c of cats) catMap.set(c.id, { ...c, products: [] });
  for (const p of products) {
    const safe = { id: p.id, name: p.name, description: p.description, price_minor: p.price_minor, promo_price_minor: p.promo_price_minor, currency: p.currency, is_featured: p.is_featured, preparation_time_minutes: p.preparation_time_minutes, emoji: p.emoji, option_group_ids: byProduct.get(p.id) ?? [] };
    const c = catMap.get(p.category_id);
    if (c) c.products.push(safe);
    else catMap.set(p.category_id, { id: p.category_id, name: p.category_name, description: null, sort_order: 0, products: [safe] });
  }
  return { venue: { name: v.name, slug: v.slug }, categories: [...catMap.values()], option_groups: [...groupMap.values()] };
}

function getActivePromotions(db, venueId, at = nowISO()) {
  return db.prepare(`SELECT * FROM promotions WHERE venue_id = ? AND is_active = 1
    AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)`).all(venueId, at, at);
}

export function createOrder(db, { slug, body, ip }) {
  const v = db.prepare('SELECT * FROM venues WHERE slug = ?').get(slug);
  if (!v) throw apiError(404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.');
  if (v.status !== 'active') throw apiError(403, 'VENUE_CLOSED', 'Este negocio no está disponible en este momento.');
  if (!feature(db, v.id, 'orders.enabled')) throw apiError(403, 'ORDERS_DISABLED', 'Este negocio no recibe pedidos en línea todavía.');

  const itemsIn = Array.isArray(body.items) ? body.items : [];
  if (!itemsIn.length) throw apiError(400, 'EMPTY_ORDER', 'Tu pedido está vacío.');
  const idemKey = body.idempotency_key;
  if (!idemKey) throw apiError(400, 'IDEMPOTENCY_REQUIRED', 'Falta la clave de idempotencia.');

  // 1) Idempotencia: misma clave → misma orden original
  const existing = db.prepare('SELECT * FROM orders WHERE idempotency_key = ?').get(idemKey);
  if (existing) return { order: orderPayload(db, existing), duplicated: true };

  const coupon = body.coupon_code ? db.prepare('SELECT * FROM coupons WHERE venue_id = ? AND code = ?').get(v.id, body.coupon_code.trim().toUpperCase()) : null;
  const fulfillment = body.fulfillment || {};
  const ftype = fulfillment.type === 'delivery' ? 'delivery' : 'pickup';
  if (ftype === 'pickup' && !v.pickup_enabled) throw apiError(403, 'PICKUP_DISABLED', 'El recojo no está disponible.');
  if (ftype === 'delivery' && !feature(db, v.id, 'delivery.enabled')) throw apiError(403, 'DELIVERY_DISABLED', 'El delivery no está disponible para este negocio.');

  return withTxn(db, () => {
    // 2) Productos, opciones, promociones (server-side total)
    let subtotal = 0, promoDiscount = 0;
    const computed = [];
    const promoRows = getActivePromotions(db, v.id);
    for (const it of itemsIn) {
      const p = db.prepare(`SELECT * FROM menu_products WHERE id = ? AND venue_id = ? AND deleted_at IS NULL`).get(it.product_id, v.id);
      if (!p || !p.is_visible || !p.is_available) throw apiError(400, 'PRODUCT_UNAVAILABLE', `Uno de los productos ya no está disponible.`);
      const qty = Math.floor(Number(it.quantity));
      if (!Number.isFinite(qty) || qty < 1 || qty > 99) throw apiError(400, 'INVALID_QUANTITY', 'Cantidad inválida.');
      if (p.track_stock && p.stock_quantity < qty) throw apiError(422, 'STOCK_OUT', `No hay suficiente stock de ${p.name} (disponible: ${p.stock_quantity}).`);
      // opciones
      let unit = p.price_minor;
      const selectedOptions = [];
      const groupIdsReq = db.prepare(`SELECT option_group_id FROM product_option_groups WHERE product_id = ?`).all(p.id).map(r => r.option_group_id);
      const optionIds = Array.isArray(it.option_ids) ? it.option_ids.map(Number) : [];
      const selGroups = new Map();
      for (const oid of optionIds) {
        const opt = db.prepare(`SELECT o.*, g.selection_type, g.min_selections, g.max_selections FROM options o JOIN option_groups g ON g.id = o.option_group_id WHERE o.id = ? AND o.venue_id = ?`).get(oid, v.id);
        if (!opt || !opt.is_available || !groupIdsReq.includes(opt.option_group_id)) throw apiError(400, 'INVALID_OPTION', 'Opción no válida para este producto.');
        unit += opt.price_minor;
        selectedOptions.push({ id: opt.id, name: opt.name, price_minor: opt.price_minor });
        selGroups.set(opt.option_group_id, (selGroups.get(opt.option_group_id) || 0) + 1);
      }
      for (const gid of groupIdsReq) {
        const g = db.prepare('SELECT * FROM option_groups WHERE id = ? AND venue_id = ?').get(gid, v.id);
        if (!g) continue;
        const n = selGroups.get(gid) || 0;
        if (g.is_required && n === 0) throw apiError(400, 'REQUIRED_OPTION', `Selecciona: ${g.name}.`);
        if (n < g.min_selections) throw apiError(400, 'OPTION_MIN', `Selecciona al menos ${g.min_selections} de ${g.name}.`);
        if (n > g.max_selections) throw apiError(400, 'OPTION_MAX', `Selecciona máximo ${g.max_selections} de ${g.name}.`);
      }
      // promociones
      let linePromo = 0;
      for (const pr of promoRows) {
        if (pr.product_id && pr.product_id !== p.id) continue;
        if (pr.promotion_type === 'special_price' && p.promo_price_minor != null && p.promo_price_minor < unit) {
          unit = p.promo_price_minor;
        } else if (pr.promotion_type === 'percentage_discount' && pr.percent_off_bps) {
          linePromo += Math.floor(unit * qty * pr.percent_off_bps / 10000);
        } else if (pr.promotion_type === 'buy_x_get_y' && pr.buy_x && pr.get_y) {
          const free = Math.floor(qty / (pr.buy_x + pr.get_y)) * pr.get_y;
          linePromo += free * unit;
        }
      }
      const lineTotal = unit * qty;
      subtotal += lineTotal;
      promoDiscount += linePromo;
      computed.push({ product_id: p.id, name: p.name, unit_price_minor: unit, qty, line_total_minor: lineTotal, line_promo_discount_minor: linePromo, options_json: JSON.stringify(selectedOptions), notes: it.notes || null });
    }
    let subtotalNet = subtotal - promoDiscount;
    if (subtotalNet < 0) subtotalNet = 0;

    // 3) Cupón (validación completa server-side)
    let couponDiscount = 0;
    if (body.coupon_code) {
      if (!coupon || !coupon.is_active) throw apiError(400, 'COUPON_INVALID', 'El cupón no es válido.');
      const at = nowISO();
      if ((coupon.starts_at && coupon.starts_at > at) || (coupon.ends_at && coupon.ends_at < at)) throw apiError(400, 'COUPON_EXPIRED', 'El cupón no está vigente.');
      if (subtotalNet < coupon.minimum_order_minor) throw apiError(400, 'COUPON_MIN_ORDER', `El cupón requiere un mínimo de S/ ${(coupon.minimum_order_minor / 100).toFixed(2)}.`);
      if (coupon.total_usage_limit != null) {
        const used = db.prepare('SELECT COUNT(*) n FROM coupon_redemptions WHERE coupon_id = ?').get(coupon.id).n;
        if (used >= coupon.total_usage_limit) throw apiError(400, 'COUPON_EXHAUSTED', 'El cupón ya no tiene usos disponibles.');
      }
      const phone = normalizePhone(body.customer?.phone);
      if (coupon.customer_usage_limit != null && phone) {
        const byCust = db.prepare('SELECT COUNT(*) n FROM coupon_redemptions WHERE coupon_id = ? AND customer_phone = ?').get(coupon.id, phone).n;
        if (byCust >= coupon.customer_usage_limit) throw apiError(400, 'COUPON_USED', 'Ya usaste este cupón.');
      }
      couponDiscount = coupon.discount_type === 'percent'
        ? Math.floor(subtotalNet * coupon.discount_value / 100)
        : Math.min(coupon.discount_value, subtotalNet);
      if (coupon.maximum_discount_minor != null && couponDiscount > coupon.maximum_discount_minor) couponDiscount = coupon.maximum_discount_minor;
    }
    const taxable = Math.max(0, subtotalNet - couponDiscount);

    // 4) Delivery
    let deliveryFee = 0, zone = null;
    if (ftype === 'delivery') {
      if (fulfillment.zone_id) {
        zone = db.prepare('SELECT * FROM delivery_zones WHERE id = ? AND venue_id = ? AND is_active = 1').get(fulfillment.zone_id, v.id);
        if (!zone) throw apiError(400, 'ZONE_INVALID', 'Zona de delivery no válida.');
        if (subtotalNet < zone.minimum_order_minor) throw apiError(400, 'MINIMUM_ORDER', `El pedido mínimo para ${zone.name} es S/ ${(zone.minimum_order_minor / 100).toFixed(2)}.`);
        deliveryFee = zone.delivery_fee_minor;
      } else {
        deliveryFee = v.flat_delivery_fee_minor || 0;
      }
    }

    // 5) Totales (minor units, server authoritative)
    const tax = Math.floor(taxable * (v.tax_rate_bps || 1800) / 10000);
    const total = taxable + tax + deliveryFee;
    const discount = promoDiscount + couponDiscount;

    // 6) Cliente por teléfono normalizado
    const customer = body.customer || {};
    const phone = normalizePhone(customer.phone);
    if (!phone) throw apiError(400, 'PHONE_REQUIRED', 'Ingresa un teléfono válido.');
    let cust = db.prepare('SELECT * FROM customers WHERE venue_id = ? AND normalized_phone = ?').get(v.id, phone);
    if (!cust) {
      const r = db.prepare(`INSERT INTO customers (venue_id, normalized_phone, name, email) VALUES (?,?,?,?)`).run(v.id, phone, customer.name || 'Cliente', customer.email || null);
      cust = { id: Number(r.lastInsertRowid), normalized_phone: phone, name: customer.name || 'Cliente', email: customer.email || null };
    } else if (customer.email && !cust.email) {
      db.prepare('UPDATE customers SET email = ?, updated_at = ? WHERE id = ?').run(customer.email, nowISO(), cust.id);
    }

    // 7) Insertar orden + items + historial + redemptions + stock (todo en la transacción)
    const token = secureToken(10);
    const r = db.prepare(`INSERT INTO orders (venue_id, customer_id, customer_name, customer_phone, customer_email, fulfillment_type, address, reference, delivery_zone_id, scheduled_for, notes, subtotal_minor, tax_minor, discount_minor, delivery_fee_minor, total_minor, coupon_code, currency, idempotency_key, public_token, status, payment_status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'pending','unpaid')`).run(
      v.id, cust.id, customer.name || 'Cliente', phone, customer.email || null, ftype,
      fulfillment.address || null, fulfillment.reference || null, zone?.id ?? null, body.scheduled_for || null,
      body.notes || null, subtotal, tax, discount, deliveryFee, total, coupon?.code ?? null, v.currency,
      idemKey, token);
    const orderId = Number(r.lastInsertRowid);
    const insItem = db.prepare(`INSERT INTO order_items (order_id, venue_id, product_id, name_snapshot, unit_price_minor, qty, line_total_minor, options_json, notes) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const c of computed) insItem.run(orderId, v.id, c.product_id, c.name, c.unit_price_minor, c.qty, c.line_total_minor - c.line_promo_discount_minor, c.options_json, c.notes);
    db.prepare(`INSERT INTO order_status_history (order_id, venue_id, status, actor_name) VALUES (?,?,?,?)`).run(orderId, v.id, 'pending', customer.name || 'Cliente');
    if (coupon) db.prepare(`INSERT INTO coupon_redemptions (coupon_id, order_id, venue_id, discount_minor, customer_phone) VALUES (?,?,?,?,?)`).run(coupon.id, orderId, v.id, couponDiscount, phone);
    const decStock = db.prepare(`UPDATE menu_products SET stock_quantity = stock_quantity - ?, updated_at = ? WHERE id = ? AND track_stock = 1`);
    for (const it of itemsIn) {
      const p = db.prepare('SELECT track_stock FROM menu_products WHERE id = ? AND venue_id = ?').get(it.product_id, v.id);
      if (p?.track_stock) decStock.run(it.quantity, nowISO(), it.product_id);
    }
    analyticsEvent(db, { venueId: v.id, eventName: 'order_created', actorType: 'customer', entityType: 'order', entityId: orderId, properties: { total, fulfillment: ftype } });
    enqueueOutbox(db, { venueId: v.id, eventType: 'order_created_business', entityType: 'order', entityId: orderId, payload: { to: v.whatsapp ?? null, order_id: orderId } });
    enqueueOutbox(db, { venueId: v.id, eventType: 'order_created_customer', entityType: 'order', entityId: orderId, payload: { to: phone, order_id: orderId } });
    audit(db, { venueId: v.id, action: 'order.created', entityType: 'order', entityId: orderId, after: { total, fulfillment: ftype, items: itemsIn.length }, ip });

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    return { order: orderPayload(db, order), duplicated: false };
  });
}

export function orderPayload(db, order) {
  const items = db.prepare(`SELECT product_id, name_snapshot AS name, unit_price_minor, qty, line_total_minor, options_json, notes FROM order_items WHERE order_id = ?`).all(order.id)
    .map((i) => ({ ...i, options: JSON.parse(i.options_json || '[]') }));
  const history = db.prepare(`SELECT status, note, actor_name, created_at FROM order_status_history WHERE order_id = ? ORDER BY id`).all(order.id);
  return {
    id: order.id,
    order_number: order.id,
    public_token: order.public_token,
    status: order.status,
    payment_status: order.payment_status,
    fulfillment_type: order.fulfillment_type,
    customer: { name: order.customer_name, phone: order.customer_phone, email: order.customer_email },
    address: order.address, reference: order.reference,
    totals: { subtotal_minor: order.subtotal_minor, tax_minor: order.tax_minor, discount_minor: order.discount_minor, delivery_fee_minor: order.delivery_fee_minor, total_minor: order.total_minor },
    coupon_code: order.coupon_code,
    notes: order.notes,
    placed_at: order.placed_at,
    completed_at: order.completed_at,
    cancelled_at: order.cancelled_at,
    items, history,
  };
}

export function getOrderPublic(db, token) {
  const o = db.prepare('SELECT * FROM orders WHERE public_token = ?').get(token);
  if (!o) return null;
  return orderPayload(db, o);
}

export async function payOrder(db, { venueId, publicToken, cardLast4 = '4242', cardBrand = 'visa', paymentMethodId, ip }) {
  const order = db.prepare('SELECT * FROM orders WHERE public_token = ? AND venue_id = ?').get(publicToken, venueId);
  if (!order) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
  if (order.status === 'cancelled') throw apiError(409, 'ORDER_CANCELLED', 'El pedido fue cancelado.');
  const paymentId = withTxn(db, () => {
    const state = db.prepare(`SELECT status FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`).get(order.id);
    if (state?.status === 'succeeded') throw apiError(409, 'PAYMENT_ALREADY_PROCESSED', 'Este pedido ya fue pagado.');
    if (state?.status === 'pending') throw apiError(409, 'PAYMENT_IN_PROGRESS', 'Ya hay un pago en proceso para este pedido.');
    const pr = db.prepare(`INSERT INTO payments (order_id, venue_id, amount_minor, status, provider, failure_code) VALUES (?,?,?,'pending',?,NULL)`).run(order.id, venueId, order.total_minor, paymentProviderName());
    apiMetrics.paymentAttempts++;
    return Number(pr.lastInsertRowid);
  });
  try {
      const res = await paymentProvider.charge({ amountMinor: order.total_minor, currency: order.currency, cardLast4, cardBrand, paymentMethodId, orderRef: String(order.id) });
      if (res.status === 'requires_action' || res.status === 'requires_confirmation') {
        // 3-D Secure: no marcar como fallido; el cliente continúa con Stripe.js.
        return { order: orderPayload(db, order), payment_id: paymentId, payment_status: res.status, client_secret: res.clientSecret, external_ref: res.externalRef };
      }
      withTxn(db, () => {
      db.prepare(`UPDATE payments SET status='succeeded', external_ref=?, updated_at=? WHERE id=?`).run(res.externalRef, nowISO(), paymentId);
      db.prepare(`UPDATE orders SET payment_status='paid', updated_at=? WHERE id=?`).run(nowISO(), order.id);
      enqueueOutbox(db, { venueId, eventType: 'order_created_business', entityType: 'order', entityId: order.id, payload: { to: order.customer_phone, paid: true, order_id: order.id } });
      audit(db, { venueId, action: 'payment.succeeded', entityType: 'payment', entityId: paymentId, after: { amount: order.total_minor }, ip });
      });
      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      return { order: orderPayload(db, updated), payment_id: paymentId, external_ref: res.externalRef };
  } catch (err) {
      const code = err instanceof ProviderOutageError ? 'provider_unavailable' : (err.code || 'payment_failed');
      withTxn(db, () => {
        db.prepare(`UPDATE payments SET status='failed', failure_code=?, updated_at=? WHERE id=?`).run(code, nowISO(), paymentId);
        db.prepare(`UPDATE orders SET payment_status='failed', updated_at=? WHERE id=?`).run(nowISO(), order.id);
        apiMetrics.paymentFailures++;
        if (code === 'provider_unavailable') apiMetrics.providerUnavailable++;
        audit(db, { venueId, action: 'payment.failed', entityType: 'payment', entityId: paymentId, after: { code }, ip });
      });
      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
      const errOut = apiError(402, code === 'provider_unavailable' ? 'PROVIDER_UNAVAILABLE' : 'PAYMENT_DECLINED', code === 'provider_unavailable' ? 'El medio de pago no está disponible ahora. Intenta en unos minutos.' : 'Tu pago fue rechazado. Verifica tu tarjeta e inténtalo de nuevo.');
      errOut.order = orderPayload(db, updated);
      throw errOut;
  }
}

export function transitionOrder(db, { venueId, orderId, newStatus, note, user, ip }) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND venue_id = ?').get(orderId, venueId);
  if (!order) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
  if (newStatus === order.status) return { order: orderPayload(db, order), noop: true };
  if (!TRANSITIONS[order.status]?.includes(newStatus)) throw apiError(409, 'INVALID_TRANSITION', `No se puede pasar de "${order.status}" a "${newStatus}".`);
  const allowed = TRANSITION_ROLES[`${order.status}>${newStatus}`] || [];
  if (!user || !allowed.includes(user.role)) throw apiError(403, 'FORBIDDEN', 'Tu rol no puede ejecutar esta transición.');

  return withTxn(db, () => {
    db.prepare(`INSERT INTO order_status_history (order_id, venue_id, status, note, actor_user_id, actor_name) VALUES (?,?,?,?,?,?)`)
      .run(order.id, venueId, newStatus, note || null, user.id, user.name);
    if (newStatus === 'cancelled') {
      db.prepare(`UPDATE orders SET status='cancelled', updated_at=?, cancelled_at=? WHERE id=?`).run(nowISO(), nowISO(), order.id);
      // restaurar stock de productos
      const items = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(order.id);
      for (const it of items) db.prepare(`UPDATE menu_products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ? AND track_stock = 1`).run(it.qty, nowISO(), it.product_id);
      // reembolso automático si estaba pagado
      const p = db.prepare(`SELECT * FROM payments WHERE order_id = ? AND status = 'succeeded' ORDER BY id DESC LIMIT 1`).get(order.id);
      if (p) {
        db.prepare(`INSERT INTO refunds (payment_id, order_id, venue_id, amount_minor, reason, created_by_user_id) VALUES (?,?,?,?,?,?)`).run(p.id, order.id, venueId, p.amount_minor, 'Cancelación de pedido', user.id);
        db.prepare(`UPDATE payments SET status='refunded', updated_at=? WHERE id=?`).run(nowISO(), p.id);
        db.prepare(`UPDATE orders SET payment_status='refunded' WHERE id=?`).run(order.id);
        enqueueOutbox(db, { venueId, eventType: 'order_created_customer', entityType: 'refund', entityId: order.id, payload: { to: order.customer_phone, refund: p.amount_minor } });
      }
    } else {
      const upd = { accepted: { }, preparing: { }, ready: { }, completed: { status: 'completed', completed_at: nowISO() } }[newStatus] || {};
      db.prepare(`UPDATE orders SET status=?, updated_at=?, completed_at=COALESCE(?, completed_at) WHERE id=?`).run(newStatus, nowISO(), upd.completed_at ?? null, order.id);
      if (newStatus === 'ready') enqueueOutbox(db, { venueId, eventType: 'order_ready_customer', entityType: 'order', entityId: order.id, payload: { to: order.customer_phone } });
      if (newStatus === 'completed') finalizeCustomer(db, order.id, venueId);
      if (newStatus === 'completed' && feature(db, venueId, 'reviews.requests.automatic.enabled')) {
        const hasReq = db.prepare('SELECT COUNT(*) n FROM review_requests WHERE order_id = ?').get(order.id).n;
        if (!hasReq) {
          const at = new Date(Date.now() + 30 * 60000).toISOString(); // 30 min después
          db.prepare(`INSERT INTO review_requests (venue_id, order_id, method, status, scheduled_for) VALUES (?,?,'automatic','scheduled',?)`).run(venueId, order.id, at);
          enqueueOutbox(db, { venueId, eventType: 'review_request', entityType: 'review_request', entityId: order.id, payload: { to: order.customer_phone, delay_min: 30 } });
        }
      }
    }
    audit(db, { venueId, user, action: `order.${newStatus}`, entityType: 'order', entityId: order.id, before: { status: order.status }, after: { status: newStatus }, ip });
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    return { order: orderPayload(db, o), noop: false };
  });
}

function finalizeCustomer(db, orderId, venueId) {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!o.customer_id) return;
  const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(o.customer_id);
  const paid = o.payment_status === 'paid' || o.payment_status === 'refunded' || o.payment_status === 'partially_refunded';
  const spent = paid ? o.total_minor : 0;
  const count = cust.orders_count + 1;
  const totalSpent = cust.total_spent_minor + spent;
  const fav = db.prepare(`SELECT product_id, SUM(qty) q FROM order_items WHERE order_id = ? GROUP BY product_id ORDER BY q DESC LIMIT 1`).get(orderId);
  db.prepare(`UPDATE customers SET orders_count=?, total_spent_minor=?, average_ticket_minor=?, last_order_at=?, first_order_at=COALESCE(first_order_at, ?), favorite_product_id=COALESCE(?, favorite_product_id), preferred_fulfillment_type=?, updated_at=? WHERE id=?`)
    .run(count, totalSpent, Math.floor(totalSpent / count), nowISO(), o.placed_at, fav?.product_id ?? null, o.fulfillment_type, nowISO(), o.customer_id);
}

export function refundOrder(db, { venueId, orderId, amountMinor, reason, user, ip }) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND venue_id = ?').get(orderId, venueId);
  if (!order) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
  if (!['paid', 'partially_refunded'].includes(order.payment_status)) throw apiError(409, 'NOT_PAID', 'El pedido no tiene un pago reembolsable.');  const p = db.prepare(`SELECT * FROM payments WHERE order_id = ? AND status IN ('succeeded','partially_refunded') ORDER BY id DESC LIMIT 1`).get(order.id);
  if (!p) throw apiError(409, 'NOT_PAID', 'No hay pago asociado.');
  const refunded = db.prepare('SELECT COALESCE(SUM(amount_minor),0) s FROM refunds WHERE payment_id = ?').get(p.id).s;
  const remaining = p.amount_minor - refunded;
  const amount = amountMinor && amountMinor > 0 ? Math.min(amountMinor, remaining) : remaining;
  if (amount <= 0) throw apiError(409, 'ALREADY_REFUNDED', 'El pedido ya fue reembolsado por completo.');

  return withTxnAsync(db, async () => {
    const res = await paymentProvider.refund({ externalRef: p.external_ref, amountMinor: amount });
    db.prepare(`INSERT INTO refunds (payment_id, order_id, venue_id, amount_minor, reason, created_by_user_id) VALUES (?,?,?,?,?,?)`).run(p.id, order.id, venueId, amount, reason || 'Reembolso', user.id);
    const newRefunded = refunded + amount;
    const pStatus = newRefunded >= p.amount_minor ? 'refunded' : 'partially_refunded';
    db.prepare(`UPDATE payments SET status=?, updated_at=? WHERE id=?`).run(pStatus, nowISO(), p.id);
    db.prepare(`UPDATE orders SET payment_status=?, updated_at=? WHERE id=?`).run(pStatus === 'refunded' ? 'refunded' : 'partially_refunded', nowISO(), order.id);
    audit(db, { venueId, user, action: 'order.refund', entityType: 'order', entityId: order.id, before: { payment_status: order.payment_status }, after: { amount, refund_status: pStatus }, ip });
    const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    return { order: orderPayload(db, o), refund_id: res.refundRef, amount_minor: amount };
  });
}

export function requestReview(db, { venueId, orderId, user, ip }) {
  if (!feature(db, venueId, 'reviews.requests.manual.enabled')) throw apiError(403, 'REVIEW_REQUESTS_DISABLED', 'Tu plan no incluye solicitudes de reseña.');
  if (!can(user.role, 'reviews.manage')) throw apiError(403, 'FORBIDDEN', 'No tienes permiso.');
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND venue_id = ?').get(orderId, venueId);
  if (!order || order.status !== 'completed') throw apiError(409, 'ORDER_NOT_COMPLETED', 'Solo se puede solicitar reseña de pedidos entregados.');
  const recent = db.prepare(`SELECT COUNT(*) n FROM review_requests WHERE order_id = ? AND created_at > ?`).get(order.id, new Date(Date.now() - 30 * 864e5).toISOString()).n;
  if (recent > 0) throw apiError(409, 'REQUEST_EXISTS', 'Ya se solicitó la reseña de este pedido recientemente.');
  const req = db.prepare(`INSERT INTO review_requests (venue_id, order_id, method, status, sent_at) VALUES (?,?,'manual','sent',?)`).run(venueId, order.id, nowISO());
  db.prepare(`INSERT INTO review_events (venue_id, event_type) VALUES (?,'request_sent')`).run(venueId);
  audit(db, { venueId, user, action: 'review.requested', entityType: 'order', entityId: order.id, ip });
  return { review_request_id: Number(req.lastInsertRowid) };
}

export function submitReview(db, { slug, publicToken, rating, comment, feedbackType, ip }) {
  const v = db.prepare('SELECT id FROM venues WHERE slug = ?').get(slug);
  if (!v) throw apiError(404, 'VENUE_NOT_FOUND', 'Negocio no encontrado.');
  const order = db.prepare('SELECT * FROM orders WHERE public_token = ? AND venue_id = ?').get(publicToken, v.id);
  if (!order) throw apiError(404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
  if (order.status !== 'completed') throw apiError(409, 'ORDER_NOT_COMPLETED', 'Puedes dejar tu reseña cuando el pedido esté entregado.');
  const r = db.prepare(`INSERT INTO private_feedback (venue_id, order_id, customer_name, customer_phone, rating, comment) VALUES (?,?,?,?,?,?)`)
    .run(v.id, order.id, order.customer_name, order.customer_phone, rating && rating >= 1 && rating <= 5 ? rating : null, comment || '');
  db.prepare(`UPDATE review_requests SET status='opened', opened_at=? WHERE order_id=? AND status IN ('sent','scheduled')`).run(nowISO(), order.id);
  db.prepare(`INSERT INTO review_events (venue_id, event_type) VALUES (?,'request_opened')`).run(v.id);
  audit(db, { venueId: v.id, action: 'review.submitted', entityType: 'order', entityId: order.id, after: { rating }, ip });
  return { feedback_id: Number(r.lastInsertRowid), google_destination: db.prepare('SELECT review_url FROM google_connections WHERE venue_id = ?').get(v.id)?.review_url ?? null };
}

// métricas operativas (observabilidad)
export const apiMetrics = {
  orderCount: 0, activeOrders: 0, paymentAttempts: 0, paymentFailures: 0, providerUnavailable: 0,
  inventoryFailedUpdates: 0, couponRedemptions: 0, latencySamples: [],
  recordLatency(ms) { this.latencySamples.push(ms); if (this.latencySamples.length > 500) this.latencySamples.shift(); },
  snapshot() {
    const s = [...this.latencySamples].sort((a, b) => a - b);
    const p = (q) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0);
    return {
      order_count: this.orderCount, active_orders: this.activeOrders, payment_attempts: this.paymentAttempts,
      payment_failures: this.paymentFailures, provider_unavailable: this.providerUnavailable,
      inventory_failed_updates: this.inventoryFailedUpdates, coupon_redemptions: this.couponRedemptions,
      latency_p50_ms: p(0.5), latency_p95_ms: p(0.95), samples: s.length,
      uptime_s: Math.round(process.uptime()),
    };
  },
};

export function apiError(status, code, message) {
  const e = new Error(message);
  e.status = status; e.code = code;
  return e;
}

export function errToHttp(e) {
  return { status: e.status || 500, code: e.code || 'INTERNAL', message: e.message || 'Error interno. Intenta nuevamente.' };
}
