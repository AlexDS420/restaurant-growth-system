// Restaurant OS — rutas públicas (storefront, checkout, reseñas, reservas, review redirect)
import { sendOk, sendError, requireAuth } from './auth.js';
import { createOrder, getOrderPublic, payOrder, submitReview, publicVenue, publicMenu, normalizePhone, apiError, errToHttp, apiMetrics } from './orders.js';
import { feature } from './entitlements.js';
import { enqueueOutbox } from './notifications.js';
import { secureToken } from './db.js';
import { verifyWebhookSignature, webhookSecret } from './payments.js';
import { withTxn, nowISO } from './db.js';

export function registerPublicRoutes(app) {
  const { db } = app;
  // La carta y el estado de un pedido son públicos; crear/pagar pedidos no.
  // Un usuario de restaurante nunca puede usar estas rutas como cliente.
  const customerAuth = [requireAuth(db), (req, res, next) => {
    if (req.user.role !== 'customer') return sendError(res, 403, 'CUSTOMER_ACCESS_REQUIRED', 'Inicia sesión con una cuenta de cliente para hacer pedidos.');
    next();
  }];

  // negocio público + estado
  app.get('/api/v1/public/venues/:slug', (req, res) => {
    try {
      const v = publicVenue(db, req.params.slug);
      if (!v) return sendError(res, 404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.');
      sendOk(res, {
        id: v.id, name: v.name, slug: v.slug, legal_name: v.legal_name, phone: v.phone, whatsapp: v.whatsapp,
        address: v.address, district: v.district, city: v.city, instagram: v.instagram, facebook: v.facebook,
        currency: v.currency, timezone: v.timezone, branding_color: v.branding_color, logo_emoji: v.logo_emoji,
        cover_emoji: v.cover_emoji, is_open: v.is_open, opening_hours: v.opening_hours,
        pickup_enabled: v.pickup_enabled, pickup_instructions: v.pickup_instructions, pickup_eta_minutes: v.pickup_eta_minutes,
        delivery_enabled: v.delivery_enabled, flat_delivery_fee_minor: v.flat_delivery_fee_minor,
        zones: db.prepare(`SELECT id, name, delivery_fee_minor, minimum_order_minor, estimated_minutes FROM delivery_zones WHERE venue_id=? AND is_active=1`).all(v.id),
        features: v.features, plan: v.plan, tax_rate_bps: v.tax_rate_bps,
        published: true,
      });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // menú público
  app.get('/api/v1/public/venues/:slug/menu', (req, res) => {
    try {
      const menu = publicMenu(db, req.params.slug);
      if (!menu) return sendError(res, 404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.');
      sendOk(res, menu);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // crear pedido (solo cliente registrado; server calcula todo)
  app.post('/api/v1/public/venues/:slug/orders', customerAuth, async (req, res) => {
    apiMetrics.orderCount++;
    try {
      // La identidad de la cuenta prevalece sobre cualquier email enviado por el navegador.
      const body = { ...req.body, customer: { ...(req.body?.customer || {}), email: req.user.email, name: req.user.name || req.body?.customer?.name || 'Cliente' } };
      const out = await createOrder(db, { slug: req.params.slug, body, ip: req.ip, actor: req.user });
      const status = out.duplicated ? 200 : 201;
      sendOk(res, { ...out.order, duplicated: out.duplicated }, status);
    } catch (e) {
      apiMetrics.inventoryFailedUpdates = e.code === 'STOCK_OUT' ? apiMetrics.inventoryFailedUpdates + 1 : apiMetrics.inventoryFailedUpdates;
      const h = errToHttp(e); sendError(res, h.status, h.code, h.message);
    }
  });

  app.get('/api/v1/public/orders/:publicToken', (req, res) => {
    try {
      const o = getOrderPublic(db, req.params.publicToken);
      if (!o) return sendError(res, 404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
      sendOk(res, o);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // pago (mock; anti doble cargo; declina con 0001, outage con 9999)
  app.post('/api/v1/public/venues/:slug/orders/:publicToken/pay', customerAuth, async (req, res) => {
    try {
      const v = db.prepare('SELECT id FROM venues WHERE slug = ?').get(req.params.slug);
      if (!v) return sendError(res, 404, 'VENUE_NOT_FOUND', 'Negocio no encontrado.');
      if (!feature(db, v.id, 'payments.online.enabled')) return sendError(res, 403, 'PAYMENTS_DISABLED', 'El pago en línea no está disponible en tu plan.');
      const body = req.body || {};
      const out = await payOrder(db, { venueId: v.id, publicToken: req.params.publicToken, cardLast4: String(body.card_last4 || '').slice(-4), cardBrand: body.card_brand || 'visa', paymentMethodId: body.payment_method_id, ip: req.ip });
      sendOk(res, out, out.payment_status === 'requires_action' || out.payment_status === 'requires_confirmation' ? 202 : 200);
    } catch (e) {
      const h = { ...errToHttp(e), order: e.order };
      sendError(res, h.status, h.code, h.message);
    }
  });

  // Webhook Stripe: firma HMAC compatible con el esquema t=timestamp,v1=hex.
  // El body debe conservarse byte a byte por el servidor/proxy para producción.
  app.post('/api/v1/webhooks/stripe', (req, res) => {
    const payload = req.rawBody || JSON.stringify(req.body || {});
    if (!verifyWebhookSignature(payload, req.headers['stripe-signature'], webhookSecret())) return sendError(res, 400, 'INVALID_WEBHOOK_SIGNATURE', 'Firma de webhook inválida.');
    const event = req.body || {};
    if (!event.id || !event.type) return sendError(res, 400, 'INVALID_WEBHOOK', 'Evento de webhook incompleto.');
    try {
      const inserted = withTxn(db, () => {
        const r = db.prepare(`INSERT OR IGNORE INTO payment_webhook_events (provider, provider_event_id, event_type, payload_json) VALUES ('stripe',?,?,?)`).run(event.id, event.type, payload);
        if (!r.changes) return false;
        const object = event.data?.object || {};
        const externalRef = object.payment_intent || (String(event.type).startsWith('payment_intent.') ? object.id : null);
        const payment = externalRef ? db.prepare('SELECT * FROM payments WHERE external_ref = ?').get(externalRef) : null;
        if (payment && ['payment_intent.succeeded', 'charge.succeeded'].includes(event.type)) {
          db.prepare("UPDATE payments SET status='succeeded', failure_code=NULL, updated_at=? WHERE id=?").run(nowISO(), payment.id);
          db.prepare("UPDATE orders SET payment_status='paid', updated_at=? WHERE id=? AND payment_status != 'paid'").run(nowISO(), payment.order_id);
        } else if (payment && ['payment_intent.payment_failed', 'charge.failed'].includes(event.type)) {
          db.prepare("UPDATE payments SET status='failed', failure_code=?, updated_at=? WHERE id=? AND status='pending'").run(object.last_payment_error?.code || 'payment_failed', nowISO(), payment.id);
          db.prepare("UPDATE orders SET payment_status='failed', updated_at=? WHERE id=? AND payment_status='pending'").run(nowISO(), payment.order_id);
        }
        db.prepare("UPDATE payment_webhook_events SET status='processed', processed_at=? WHERE provider='stripe' AND provider_event_id=?").run(nowISO(), event.id);
        return true;
      });
      return sendOk(res, { received: true, duplicate: !inserted });
    } catch (e) { return sendError(res, 500, 'WEBHOOK_PROCESSING_FAILED', 'No se pudo procesar el webhook.'); }
  });

  // reseña post-entrega (Google + comentario privado, sin gating)
  app.post('/api/v1/public/venues/:slug/orders/:publicToken/review', (req, res) => {
    try {
      const b = req.body || {};
      const out = submitReview(db, { slug: req.params.slug, publicToken: req.params.publicToken, rating: Number(b.rating), comment: String(b.comment || ''), feedbackType: b.feedback_type || 'private', ip: req.ip });
      sendOk(res, out, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // reserva pública (Pro)
  app.post('/api/v1/public/venues/:slug/reservations', (req, res) => {
    try {
      const out = createReservation(db, { slug: req.params.slug, body: req.body || {}, ip: req.ip });
      sendOk(res, out, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  app.get('/api/v1/public/venues/:slug/reservations/:token', (req, res) => {
    try {
      const r = db.prepare(`SELECT r.public_token, r.name, r.phone, r.datetime, r.party_size, r.status, r.comments FROM reservations r JOIN venues v ON v.id = r.venue_id WHERE v.slug = ? AND r.public_token = ?`).get(req.params.slug, req.params.token);
      if (!r) return sendError(res, 404, 'RESERVATION_NOT_FOUND', 'Reserva no encontrada.');
      sendOk(res, r);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // comentario privado genérico
  app.post('/api/v1/feedback', (req, res) => {
    try {
      const b = req.body || {};
      const v = db.prepare('SELECT id FROM venues WHERE slug = ?').get(b.venue_slug);
      if (!v) return sendError(res, 404, 'VENUE_NOT_FOUND', 'Negocio no encontrado.');
      const phone = normalizePhone(b.phone);
      const r = db.prepare(`INSERT INTO private_feedback (venue_id, customer_name, customer_phone, rating, comment) VALUES (?,?,?,?,?)`)
        .run(v.id, b.name || 'Anónimo', phone, b.rating ? Number(b.rating) : null, String(b.comment || ''));
      sendOk(res, { feedback_id: Number(r.lastInsertRowid) }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // eventos de analítica (batch, storefront)
  app.post('/api/v1/events/batch', (req, res) => {
    try {
      const events = Array.isArray(req.body?.events) ? req.body.events : [];
      const ins = db.prepare(`INSERT INTO analytics_events (venue_id, session_id, event_name, actor_type, entity_type, entity_id, properties_json) VALUES (?,?,?,?,?,?,?)`);
      let n = 0;
      for (const ev of events) {
        if (!ev?.event_name) continue;
        const vid = ev.venue_id ? db.prepare('SELECT id FROM venues WHERE id = ?').get(Number(ev.venue_id))?.id : null;
        if (!vid) continue;
        ins.run(vid, ev.session_id || null, String(ev.event_name), ev.actor_type || 'customer', ev.entity_type || null, ev.entity_id == null ? null : String(ev.entity_id), JSON.stringify(ev.properties || {}));
        n++;
      }
      sendOk(res, { recorded: n });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // redirect de punto de reseña con tracking (blueprint §21.5)
  app.get('/r/:reviewToken', (req, res) => {
    try {
      const pt = db.prepare('SELECT * FROM review_points WHERE token = ?').get(req.params.reviewToken);
      if (!pt || !pt.is_active) return sendError(res, 404, 'REVIEW_POINT_INACTIVE', 'Este punto de reseña no está activo.');
      db.prepare(`UPDATE review_points SET opened_count = opened_count + 1, last_opened_at = ? WHERE id = ?`).run(new Date().toISOString(), pt.id);
      db.prepare(`INSERT INTO review_events (venue_id, review_point_id, event_type) VALUES (?,?,'opened')`).run(pt.venue_id, pt.id);
      res.writeHead(302, { Location: pt.destination_url });
      res.end();
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
}

function createReservation(db, { slug, body, ip }) {
  const v = db.prepare('SELECT * FROM venues WHERE slug = ?').get(slug);
  if (!v) throw apiError(404, 'VENUE_NOT_FOUND', 'No encontramos este negocio.');
  if (!feature(db, v.id, 'reservations.enabled')) throw apiError(403, 'RESERVATIONS_DISABLED', 'Las reservas en línea no están disponibles en este negocio.');
  const settings = db.prepare('SELECT * FROM reservation_settings WHERE venue_id = ?').get(v.id);
  const party = Number(body.party_size);
  const dt = new Date(body.datetime);
  if (!Number.isFinite(party) || party < 1) throw apiError(400, 'PARTY_SIZE_INVALID', 'Indica el número de personas.');
  if (isNaN(dt.getTime())) throw apiError(400, 'DATETIME_INVALID', 'Fecha y hora inválidas.');
  if (settings) {
    if (party > settings.max_party_size) throw apiError(400, 'PARTY_TOO_LARGE', `Máximo ${settings.max_party_size} personas por reserva.`);
    const minA = settings.min_advance_minutes * 60000;
    if (dt.getTime() - Date.now() < minA) throw apiError(400, 'MIN_ADVANCE', 'La reserva debe hacerse con antelación.');
    const maxA = settings.max_advance_days * 864e5;
    if (dt.getTime() - Date.now() > maxA) throw apiError(400, 'MAX_ADVANCE', 'La fecha está muy lejana.');
  }
  const phone = normalizePhone(body.phone);
  if (!phone) throw apiError(400, 'PHONE_REQUIRED', 'Ingresa un teléfono válido.');
  const token = secureToken(8);
  const r = db.prepare(`INSERT INTO reservations (venue_id, public_token, name, phone, email, datetime, party_size, status, comments) VALUES (?,?,?,?,?,?,?,'pending',?)`)
    .run(v.id, token, String(body.name || 'Cliente').slice(0, 120), phone, body.email || null, dt.toISOString(), party, body.comments || null);
  const rid = Number(r.lastInsertRowid);
  db.prepare(`INSERT INTO reservation_status_history (reservation_id, venue_id, status, actor_user_id) VALUES (?,?,?,NULL)`).run(rid, v.id, 'pending');
  enqueueOutbox(db, { venueId: v.id, eventType: 'reservation_created', entityType: 'reservation', entityId: rid, payload: { to: phone } });
  return { reservation_id: rid, public_token: token, status: 'pending' };
}
