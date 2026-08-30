// Restaurant OS — rutas autenticadas (panel de negocio, equipo, billing, auditoría, superadmin)
import { sendOk, sendError, requireAuth, requirePerm, hashPassword, verifyPassword, createSession, destroySession, ROLE_PERMISSIONS } from './auth.js';
import { audit, nowISO, withTxn, analyticsEvent, secureToken } from './db.js';
import { feature, featuresOf, currentPlan, enforceCount, checkTrial } from './entitlements.js';
import { transitionOrder, refundOrder, requestReview, orderPayload, apiError, errToHttp, apiMetrics } from './orders.js';
import { enqueueOutbox, NOTIFICATION_TEMPLATES } from './notifications.js';
import { config } from './config.js';
import { reconcilePayments } from './payments.js';

export function registerAppRoutes(app) {
  const { db } = app;
  const auth = (perm) => [requireAuth(db), requirePerm(db, perm)];

  // Diferencias entre estado del proveedor y estado local; solo lectura para operación.
  app.get('/api/v1/payments/reconciliation', auth('payments.read'), (req, res) => {
    try { sendOk(res, { provider: process.env.PAYMENTS_MODE || 'mock', generated_at: nowISO(), mismatches: reconcilePayments(db, { venueId: req.user.venue_id }) }); }
    catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- AUTH ----------
  app.post('/api/v1/auth/register', (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name || !b.email || !b.password || !b.business_name) return sendError(res, 400, 'VALIDATION', 'Completa nombre, correo, contraseña y nombre del negocio.');
      const email = String(b.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, 'VALIDATION', 'Ingresa un correo válido.');
      if (String(b.password).length < 8) return sendError(res, 400, 'VALIDATION', 'La contraseña debe tener al menos 8 caracteres.');
      const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (exists) return sendError(res, 409, 'EMAIL_TAKEN', 'Ya existe una cuenta con ese correo.');
      let slug = String(b.slug || b.business_name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      if (!slug) slug = 'negocio-' + Math.floor(Math.random() * 9000 + 1000);
      let base = slug, n = 1;
      while (db.prepare('SELECT id FROM venues WHERE slug = ?').get(slug)) slug = `${base}-${++n}`;

      const orgId = secureToken(6);
      const out = withTxn(db, () => {
        const vr = db.prepare(`INSERT INTO venues (organization_id, location_id, name, slug, business_type, phone, whatsapp, email, city, currency) VALUES (?,?,?,?,?,?,?,?, 'Lima','PEN')`)
          .run(orgId, orgId + '-L1', b.business_name, slug, b.business_type || 'restaurante', b.phone || null, b.whatsapp || b.phone || null, email);
        const vid = Number(vr.lastInsertRowid);
        const ur = db.prepare(`INSERT INTO users (venue_id, email, name, phone, password_hash, role) VALUES (?,?,?,?,?,'owner')`).run(vid, email, b.name, b.phone || null, hashPassword(b.password));
        const uid = Number(ur.lastInsertRowid);
        const trialEnd = new Date(Date.now() + 7 * 864e5).toISOString();
        db.prepare(`INSERT INTO subscriptions (venue_id, plan_id, status, trial_ends_at, current_period_start, current_period_end) VALUES (?, 'pro','trialing',?,?,?)`).run(vid, trialEnd, nowISO(), new Date(Date.now() + 31 * 864e5).toISOString());
        db.prepare(`INSERT INTO subscription_events (subscription_id, venue_id, event_type, payload_json) VALUES ((SELECT id FROM subscriptions WHERE venue_id = ?), ?, 'trial_started', ?)`).run(vid, vid, JSON.stringify({ days: 7, plan: 'pro' }));
        db.prepare(`INSERT INTO reservation_settings (venue_id) VALUES (?)`).run(vid);
        analyticsEvent(db, { venueId: vid, eventName: 'venue_registered', actorType: 'owner', entityType: 'venue', entityId: vid });
        audit(db, { venueId: vid, user: { id: uid, email, role: 'owner' }, action: 'venue.registered', entityType: 'venue', entityId: vid });
        const token = createSession(db, uid);
        return { vid, uid, token };
      });
      res.setHeader('Set-Cookie', sessionCookie(out.token));
      sendOk(res, { user: { id: out.uid, email, name: b.name, role: 'owner' }, venue: { id: out.vid, slug, name: b.business_name, plan: 'pro', trial_days_left: 7 } }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  app.post('/api/v1/auth/login', (req, res) => {
    try {
      const b = req.body || {};
      const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(b.email || '').toLowerCase());
      if (!u || !verifyPassword(String(b.password || ''), u.password_hash)) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
      if (!u.active) return sendError(res, 403, 'ACCOUNT_DISABLED', 'Tu cuenta está desactivada. Contacta al soporte.');
      if (u.role === 'customer') return sendError(res, 403, 'CUSTOMER_LOGIN_REQUIRED', 'Usa el acceso cliente para continuar.');
      const token = createSession(db, u.id);
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowISO(), u.id);
      res.setHeader('Set-Cookie', sessionCookie(token));
      sendOk(res, { user: { id: u.id, email: u.email, name: u.name, role: u.role, venue_id: u.venue_id }, venue: u.venue_id ? venueBrief(db, u.venue_id) : null });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // El preview local usa este mismo servidor como BFF. Mantener un endpoint
  // explícito evita que el formulario de cliente caiga en la configuración
  // pública de Supabase cuando se prueba sin un PHP local.
  app.post('/api/v1/auth/customer-login', (req, res) => {
    try {
      const b = req.body || {};
      const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(b.email || '').trim().toLowerCase());
      if (!u || !verifyPassword(String(b.password || ''), u.password_hash)) return sendError(res, 401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
      if (!u.active) return sendError(res, 403, 'ACCOUNT_DISABLED', 'Tu cuenta está desactivada. Contacta al soporte.');
      if (u.role !== 'customer') return sendError(res, 403, 'CUSTOMER_ACCESS_REQUIRED', 'Esta cuenta está vinculada a un restaurante.');
      const token = createSession(db, u.id);
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowISO(), u.id);
      res.setHeader('Set-Cookie', sessionCookie(token));
      sendOk(res, { user: { id: u.id, email: u.email, name: u.name, role: u.role, venue_id: u.venue_id } });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  app.post('/api/v1/auth/logout', (req, res) => {
    const cookie = req.headers.cookie || '';
    const m = cookie.match(/(?:^|;\s*)ros_session=([^;]+)/);
    if (m) destroySession(db, decodeURIComponent(m[1]));
    res.setHeader('Set-Cookie', `ros_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${config.env === 'production' ? '; Secure' : ''}`);
    sendOk(res, { logged_out: true });
  });

  app.get('/api/v1/me', requireAuth(db), (req, res) => {
    const u = req.user;
    sendOk(res, { user: { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, venue_id: u.venue_id, permissions: ROLE_PERMISSIONS[u.role] || [] }, venue: u.venue_id ? venueBrief(db, u.venue_id) : null });
  });

  app.get('/api/v1/me/orders', requireAuth(db), (req, res) => {
    try {
      const u = req.user;
      if (u.role !== 'customer') return sendError(res, 403, 'CUSTOMER_ACCESS_REQUIRED', 'Esta vista está disponible para cuentas de cliente.');
      const rows = db.prepare(`
        SELECT o.id, o.order_number, o.status, o.payment_status, o.fulfillment_type, o.total_minor, o.placed_at, o.public_token
        FROM orders o JOIN customers c ON c.id = o.customer_id
        WHERE c.email = ? OR c.normalized_phone = ?
        ORDER BY o.placed_at DESC LIMIT 50`).all(u.email, u.phone || '');
      sendOk(res, rows);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  app.patch('/api/v1/me', requireAuth(db), (req, res) => {
    try {
      const u = req.user; const b = req.body || {};
      const sets = [], vals = [];
      if (b.name !== undefined) { sets.push('name = ?'); vals.push(String(b.name).trim()); }
      if (b.phone !== undefined) { sets.push('phone = ?'); vals.push(String(b.phone).trim()); }
      if (!sets.length) return sendOk(res, { updated: false });
      withTxn(db, () => {
        db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, u.id);
        const after = db.prepare('SELECT email, name, phone FROM users WHERE id = ?').get(u.id);
        audit(db, { venueId: u.venue_id, user: u, action: 'user.profile_updated', entityType: 'user', entityId: u.id, afterJson: after });
      });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- VENUE ----------
  app.get('/api/v1/venue', auth('venue.manage'), (req, res) => {
    try {
      const v = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.user.venue_id);
      if (!v) return sendError(res, 404, 'VENUE_NOT_FOUND', 'Negocio no encontrado.');
      checkTrial(db, v.id);
      const sub = db.prepare(`SELECT s.*, p.name AS plan_name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.venue_id = ? ORDER BY s.id DESC LIMIT 1`).get(v.id);
      sendOk(res, {
        ...spotlight(v), features: featuresOf(db, v.id), subscription: sub ? {
          plan: sub.plan_id, plan_name: sub.plan_name, status: sub.status, trial_ends_at: sub.trial_ends_at,
          current_period_end: sub.current_period_end, cancel_at_period_end: sub.cancel_at_period_end,
        } : null,
        onboarding: onboardingState(db, v),
      });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  app.patch('/api/v1/venue', auth('venue.manage'), (req, res) => {
    try {
      const v = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.user.venue_id);
      const b = req.body || {};
      const allowed = ['name', 'legal_name', 'business_type', 'phone', 'whatsapp', 'email', 'address', 'district', 'city', 'lat', 'lng', 'branding_color', 'logo_emoji', 'cover_emoji', 'instagram', 'facebook', 'pickup_enabled', 'pickup_instructions', 'pickup_eta_minutes', 'delivery_enabled', 'flat_delivery_fee_minor', 'enforce_opening_hours', 'opening_hours_json', 'tax_rate_bps'];
      const sets = [], vals = [];
      for (const k of allowed) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
      if (!sets.length) return sendOk(res, { updated: false });
      sets.push('updated_at = ?'); vals.push(nowISO());
      withTxn(db, () => {
        db.prepare(`UPDATE venues SET ${sets.join(', ')} WHERE id = ?`).run(...vals, v.id);
        audit(db, { venueId: v.id, user: req.user, action: 'venue.updated', entityType: 'venue', entityId: v.id, before: spotlight(v), after: { fields: sets } });
      });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- MENÚ ----------
  app.get('/api/v1/menu/categories', auth('menu.read'), (req, res) => {
    const rows = db.prepare(`SELECT * FROM menu_categories WHERE venue_id = ? AND deleted_at IS NULL ORDER BY sort_order, name`).all(req.user.venue_id);
    sendOk(res, rows.map((c) => ({ ...c, deleted_at: undefined })));
  });
  app.post('/api/v1/menu/categories', auth('menu.products.write'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name) return sendError(res, 400, 'VALIDATION', 'El nombre de la categoría es obligatorio.');
      const r = db.prepare(`INSERT INTO menu_categories (venue_id, name, description, sort_order, is_visible) VALUES (?,?,?,?,?)`).run(req.user.venue_id, b.name, b.description || null, b.sort_order || 0, b.is_visible === undefined ? 1 : Number(b.is_visible));
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'menu.category_created', entityType: 'menu_category', entityId: Number(r.lastInsertRowid), after: { name: b.name } });
      sendOk(res, { id: Number(r.lastInsertRowid) }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.patch('/api/v1/menu/categories/:id', auth('menu.products.write'), (req, res) => {
    try {
      const b = req.body || {};
      const exists = db.prepare('SELECT * FROM menu_categories WHERE id = ? AND venue_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.venue_id);
      if (!exists) return sendError(res, 404, 'NOT_FOUND', 'Categoría no encontrada.');
      const sets = [], vals = [];
      for (const k of ['name', 'description', 'sort_order', 'is_visible']) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
      if (sets.length) { sets.push('updated_at = ?'); vals.push(nowISO()); db.prepare(`UPDATE menu_categories SET ${sets.join(', ')} WHERE id = ?`).run(...vals, exists.id); }
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'menu.category_updated', entityType: 'menu_category', entityId: exists.id, before: { name: exists.name } });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.delete('/api/v1/menu/categories/:id', auth('menu.products.write'), (req, res) => {
    try {
      const r = db.prepare(`UPDATE menu_categories SET deleted_at = ?, updated_at = ? WHERE id = ? AND venue_id = ?`).run(nowISO(), nowISO(), req.params.id, req.user.venue_id);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'menu.category_archived', entityType: 'menu_category', entityId: req.params.id });
      sendOk(res, { archived: r.changes > 0 });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  app.get('/api/v1/menu/products', auth('menu.read'), (req, res) => {
    const rows = db.prepare(`SELECT p.*, c.name AS category_name FROM menu_products p JOIN menu_categories c ON c.id = p.category_id WHERE p.venue_id = ? AND p.deleted_at IS NULL ORDER BY p.sort_order, p.name`).all(req.user.venue_id);
    sendOk(res, rows.map((p) => ({ ...p, deleted_at: undefined })));
  });
  app.post('/api/v1/menu/products', auth('menu.products.write'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name || b.price_minor == null) return sendError(res, 400, 'VALIDATION', 'Nombre y precio son obligatorios.');
      checkTrial(db, req.user.venue_id);
      const count = db.prepare('SELECT COUNT(*) n FROM menu_products WHERE venue_id = ? AND deleted_at IS NULL').get(req.user.venue_id).n;
      enforceCount(db, req.user.venue_id, 'menu.products.max', count);
      const cat = db.prepare('SELECT id FROM menu_categories WHERE id = ? AND venue_id = ? AND deleted_at IS NULL').get(b.category_id, req.user.venue_id);
      if (!cat) return sendError(res, 400, 'VALIDATION', 'Categoría no válida.');
      const r = db.prepare(`INSERT INTO menu_products (venue_id, category_id, name, description, sku, price_minor, promo_price_minor, track_stock, stock_quantity, is_available, is_visible, is_featured, preparation_time_minutes, emoji, sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        req.user.venue_id, b.category_id, b.name, b.description || null, b.sku || null, Number(b.price_minor), b.promo_price_minor == null ? null : Number(b.promo_price_minor),
        b.track_stock ? 1 : 0, Number(b.stock_quantity) || 0, b.is_available === undefined ? 1 : Number(b.is_available), b.is_visible === undefined ? 1 : Number(b.is_visible),
        b.is_featured ? 1 : 0, Number(b.preparation_time_minutes) || 15, b.emoji || '🍽️', Number(b.sort_order) || 0);
      const pid = Number(r.lastInsertRowid);
      if (Array.isArray(b.option_group_ids)) {
        const ins = db.prepare('INSERT OR IGNORE INTO product_option_groups (product_id, option_group_id) VALUES (?,?)');
        for (const gid of b.option_group_ids) ins.run(pid, gid);
      }
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'menu.product_created', entityType: 'menu_product', entityId: pid, after: { name: b.name, price_minor: Number(b.price_minor) } });
      analyticsEvent(db, { venueId: req.user.venue_id, eventName: 'product_created', actorType: req.user.role, entityType: 'menu_product', entityId: pid });
      sendOk(res, { id: pid }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.patch('/api/v1/menu/products/:id', auth('menu.products.write'), (req, res) => {
    try {
      const b = req.body || {};
      const p = db.prepare('SELECT * FROM menu_products WHERE id = ? AND venue_id = ? AND deleted_at IS NULL').get(req.params.id, req.user.venue_id);
      if (!p) return sendError(res, 404, 'NOT_FOUND', 'Producto no encontrado.');
      const allowed = ['name', 'description', 'sku', 'price_minor', 'promo_price_minor', 'track_stock', 'stock_quantity', 'is_available', 'is_visible', 'is_featured', 'preparation_time_minutes', 'emoji', 'sort_order', 'category_id'];
      const sets = [], vals = [];
      for (const k of allowed) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
      if (sets.length) { sets.push('updated_at = ?'); vals.push(nowISO()); db.prepare(`UPDATE menu_products SET ${sets.join(', ')} WHERE id = ?`).run(...vals, p.id); }
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'menu.product_updated', entityType: 'menu_product', entityId: p.id, before: { name: p.name, price_minor: p.price_minor }, after: b });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.delete('/api/v1/menu/products/:id', auth('menu.products.write'), (req, res) => {
    try {
      const r = db.prepare(`UPDATE menu_products SET deleted_at = ?, updated_at = ?, is_visible = 0 WHERE id = ? AND venue_id = ?`).run(nowISO(), nowISO(), req.params.id, req.user.venue_id);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'menu.product_archived', entityType: 'menu_product', entityId: req.params.id });
      sendOk(res, { archived: r.changes > 0 });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.post('/api/v1/menu/products/:id/stock', auth('inventory.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const delta = Number(b.change_qty);
      if (!Number.isFinite(delta) || delta === 0) return sendError(res, 400, 'VALIDATION', 'Indica una cantidad distinta de cero.');
      const p = db.prepare('SELECT * FROM menu_products WHERE id = ? AND venue_id = ? AND track_stock = 1').get(req.params.id, req.user.venue_id);
      if (!p) return sendError(res, 404, 'NOT_FOUND', 'Producto sin control de stock.');
      withTxn(db, () => {
        const r = db.prepare(`UPDATE menu_products SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE id = ? AND venue_id = ? AND stock_quantity + ? >= 0`).run(delta, nowISO(), p.id, req.user.venue_id, delta);
        if (r.changes === 0) throw apiError(409, 'STOCK_NEGATIVE', 'El stock no puede quedar en negativo.');
        audit(db, { venueId: req.user.venue_id, user: req.user, action: 'menu.stock_adjusted', entityType: 'menu_product', entityId: p.id, before: { stock_quantity: p.stock_quantity }, after: { change_qty: delta } });
      });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // grupos de opciones
  app.get('/api/v1/menu/option-groups', auth('menu.read'), (req, res) => {
    const rows = db.prepare(`SELECT g.*, (SELECT json_group_array(json_object('id', o.id, 'name', o.name, 'price_minor', o.price_minor, 'is_available', o.is_available)) FROM options o WHERE o.option_group_id = g.id ORDER BY o.sort_order) AS options_json
      FROM option_groups g WHERE g.venue_id = ? ORDER BY g.sort_order`).all(req.user.venue_id);
    sendOk(res, rows.map((g) => ({ ...g, options: JSON.parse(g.options_json || '[]') })));
  });
  app.post('/api/v1/menu/option-groups', auth('menu.products.write'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name) return sendError(res, 400, 'VALIDATION', 'Nombre del grupo obligatorio.');
      const r = db.prepare(`INSERT INTO option_groups (venue_id, name, is_required, selection_type, min_selections, max_selections, sort_order) VALUES (?,?,?,?,?,?,?)`)
        .run(req.user.venue_id, b.name, b.is_required ? 1 : 0, b.selection_type === 'multiple' ? 'multiple' : 'single', Number(b.min_selections) || (b.is_required ? 1 : 0), Number(b.max_selections) || 1, Number(b.sort_order) || 0);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'menu.option_group_created', entityType: 'option_group', entityId: Number(r.lastInsertRowid) });
      sendOk(res, { id: Number(r.lastInsertRowid) }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.post('/api/v1/menu/option-groups/:id/options', auth('menu.products.write'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name) return sendError(res, 400, 'VALIDATION', 'Nombre de la opción obligatorio.');
      const ok = db.prepare('SELECT id FROM option_groups WHERE id = ? AND venue_id = ?').get(req.params.id, req.user.venue_id);
      if (!ok) return sendError(res, 404, 'NOT_FOUND', 'Grupo no encontrado.');
      const r = db.prepare(`INSERT INTO options (option_group_id, venue_id, name, price_minor, is_available, sort_order) VALUES (?,?,?,?,?,?)`)
        .run(ok.id, req.user.venue_id, b.name, Number(b.price_minor) || 0, b.is_available === undefined ? 1 : Number(b.is_available), Number(b.sort_order) || 0);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'menu.option_created', entityType: 'option', entityId: Number(r.lastInsertRowid) });
      sendOk(res, { id: Number(r.lastInsertRowid) }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- PEDIDOS ----------
  app.get('/api/v1/orders', auth('orders.read'), (req, res) => {
    const q = req.query || {};
    let sql = `SELECT * FROM orders WHERE venue_id = ?`;
    const vals = [req.user.venue_id];
    if (q.status) { sql += ' AND status = ?'; vals.push(q.status); }
    if (q.payment) { sql += ' AND payment_status = ?'; vals.push(q.payment); }
    if (q.fulfillment) { sql += ' AND fulfillment_type = ?'; vals.push(q.fulfillment); }
    if (q.date === 'today') sql += ' AND placed_at >= date(\'now\')';
    else if (q.date === 'yesterday') sql += ' AND placed_at >= date(\'now\',\'-1 day\') AND placed_at < date(\'now\')';
    else if (q.date === 'week') sql += ' AND placed_at >= datetime(\'now\',\'-7 days\')';
    if (q.q) { sql += ' AND (customer_name LIKE ? OR customer_phone LIKE ? OR CAST(id AS TEXT) LIKE ?)'; const like = `%${q.q}%`; vals.push(like, like, like); }
    sql += ' ORDER BY id DESC LIMIT 200';
    const rows = db.prepare(sql).all(...vals);
    sendOk(res, rows.map((o) => ({ ...orderPayload(db, o), history: undefined })));
  });
  app.get('/api/v1/orders/:id', auth('orders.read'), (req, res) => {
    const o = db.prepare('SELECT * FROM orders WHERE id = ? AND venue_id = ?').get(req.params.id, req.user.venue_id);
    if (!o) return sendError(res, 404, 'ORDER_NOT_FOUND', 'Pedido no encontrado.');
    sendOk(res, orderPayload(db, o));
  });
  app.post('/api/v1/orders/:id/transition', auth('orders.transition'), (req, res) => {
    try {
      const b = req.body || {};
      const out = transitionOrder(db, { venueId: req.user.venue_id, orderId: Number(req.params.id), newStatus: b.status, note: b.note, user: req.user, ip: req.ip });
      sendOk(res, out);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.get('/api/v1/orders/:id/payments', auth('payments.read'), (req, res) => {
    const rows = db.prepare('SELECT id, amount_minor, status, provider, external_ref, failure_code, created_at FROM payments WHERE order_id = ? AND venue_id = ? ORDER BY id').all(req.params.id, req.user.venue_id);
    const refunds = db.prepare(`SELECT r.* FROM refunds r JOIN orders o ON o.id = r.order_id WHERE r.order_id = ? AND o.venue_id = ? ORDER BY r.id`).all(req.params.id, req.user.venue_id);
    sendOk(res, { payments: rows, refunds });
  });
  app.post('/api/v1/orders/:id/refund', auth('orders.refund'), async (req, res) => {
    try {
      const b = req.body || {};
      const out = await refundOrder(db, { venueId: req.user.venue_id, orderId: Number(req.params.id), amountMinor: Number(b.amount_minor) || 0, reason: b.reason, user: req.user, ip: req.ip });
      sendOk(res, out);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.post('/api/v1/orders/:id/request-review', auth('reviews.manage'), (req, res) => {
    try {
      const out = requestReview(db, { venueId: req.user.venue_id, orderId: Number(req.params.id), user: req.user, ip: req.ip });
      sendOk(res, out, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- INVENTARIO ----------
  app.get('/api/v1/inventory', auth('inventory.manage'), (req, res) => {
    const items = db.prepare(`SELECT i.*, COALESCE((SELECT SUM(change_qty) FROM inventory_movements m WHERE m.inventory_item_id = i.id), 0) AS computed_qty,
      (SELECT MAX(created_at) FROM inventory_movements m WHERE m.inventory_item_id = i.id) AS last_movement_at
      FROM inventory_items i WHERE i.venue_id = ? ORDER BY i.name`).all(req.user.venue_id);
    const low = items.filter((i) => i.reorder_level > 0 && i.qty_on_hand <= i.reorder_level);
    sendOk(res, { items, low_stock: low });
  });
  app.post('/api/v1/inventory/items', auth('inventory.manage'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name) return sendError(res, 400, 'VALIDATION', 'Nombre del ítem obligatorio.');
      const r = db.prepare(`INSERT INTO inventory_items (venue_id, name, unit, qty_on_hand, reorder_level) VALUES (?,?,?,?,?)`).run(req.user.venue_id, b.name, b.unit || 'unidad', Number(b.qty_on_hand) || 0, Number(b.reorder_level) || 0);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'inventory.item_created', entityType: 'inventory_item', entityId: Number(r.lastInsertRowid) });
      sendOk(res, { id: Number(r.lastInsertRowid) }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.post('/api/v1/inventory/movements', auth('inventory.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const delta = Number(b.change_qty);
      if (!Number.isFinite(delta) || delta === 0) return sendError(res, 400, 'VALIDATION', 'Cantidad inválida.');
      const it = db.prepare('SELECT * FROM inventory_items WHERE id = ? AND venue_id = ?').get(b.item_id, req.user.venue_id);
      if (!it) return sendError(res, 404, 'NOT_FOUND', 'Ítem no encontrado.');
      const reason = ['purchase', 'usage', 'adjustment'].includes(b.reason) ? b.reason : 'adjustment';
      withTxn(db, () => {
        const r2 = db.prepare(`UPDATE inventory_items SET qty_on_hand = qty_on_hand + ?, updated_at = ? WHERE id = ? AND qty_on_hand + ? >= 0`).run(delta, nowISO(), it.id, delta);
        if (r2.changes === 0) { apiMetrics.inventoryFailedUpdates++; throw apiError(409, 'STOCK_NEGATIVE', 'El inventario no puede quedar en negativo.'); }
        const mr = db.prepare(`INSERT INTO inventory_movements (inventory_item_id, venue_id, change_qty, reason, user_id) VALUES (?,?,?,?,?)`).run(it.id, req.user.venue_id, delta, reason, req.user.id);
        audit(db, { venueId: req.user.venue_id, user: req.user, action: 'inventory.movement', entityType: 'inventory_item', entityId: it.id, before: { qty_on_hand: it.qty_on_hand }, after: { change_qty: delta, reason } });
        sendOk(res, { movement_id: Number(mr.lastInsertRowid), qty_on_hand: it.qty_on_hand + delta });
      });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.get('/api/v1/inventory/movements', auth('inventory.manage'), (req, res) => {
    const rows = db.prepare(`SELECT m.*, i.name AS item_name FROM inventory_movements m JOIN inventory_items i ON i.id = m.inventory_item_id WHERE m.venue_id = ? ORDER BY m.id DESC LIMIT 200`).all(req.user.venue_id);
    sendOk(res, rows);
  });

  // ---------- CLIENTES ----------
  app.get('/api/v1/customers', auth('customers.read'), (req, res) => {
    const q = req.query?.q;
    let sql = 'SELECT * FROM customers WHERE venue_id = ?';
    const vals = [req.user.venue_id];
    if (q) { sql += ' AND (name LIKE ? OR normalized_phone LIKE ? OR email LIKE ?)'; const like = `%${q}%`; vals.push(like, like, like); }
    sql += ' ORDER BY last_order_at DESC NULLS LAST LIMIT 200';
    sendOk(res, db.prepare(sql).all(...vals));
  });
  app.get('/api/v1/customers/:id', auth('customers.read'), (req, res) => {
    const c = db.prepare('SELECT * FROM customers WHERE id = ? AND venue_id = ?').get(req.params.id, req.user.venue_id);
    if (!c) return sendError(res, 404, 'NOT_FOUND', 'Cliente no encontrado.');
    const orders = db.prepare('SELECT id, status, payment_status, total_minor, fulfillment_type, placed_at FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 20').all(c.id);
    const notes = db.prepare('SELECT n.*, u.name AS author FROM customer_notes n LEFT JOIN users u ON u.id = n.created_by_user_id WHERE n.customer_id = ? ORDER BY n.id DESC').all(c.id);
    const reviews = db.prepare('SELECT f.rating, f.comment, f.created_at FROM private_feedback f WHERE f.customer_phone = ? AND f.venue_id = ? ORDER BY f.id DESC').all(c.normalized_phone, req.user.venue_id);
    sendOk(res, { ...c, orders, notes, reviews });
  });
  app.post('/api/v1/customers/:id/notes', auth('customers.write'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.note) return sendError(res, 400, 'VALIDATION', 'La nota no puede ir vacía.');
      const c = db.prepare('SELECT id FROM customers WHERE id = ? AND venue_id = ?').get(req.params.id, req.user.venue_id);
      if (!c) return sendError(res, 404, 'NOT_FOUND', 'Cliente no encontrado.');
      const r = db.prepare(`INSERT INTO customer_notes (customer_id, venue_id, note, created_by_user_id) VALUES (?,?,?,?)`).run(c.id, req.user.venue_id, b.note, req.user.id);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'customer.note_created', entityType: 'customer', entityId: c.id });
      sendOk(res, { id: Number(r.lastInsertRowid) }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- PROMOCIONES Y CUPONES ----------
  app.get('/api/v1/promotions', auth('menu.read'), (req, res) => sendOk(res, db.prepare('SELECT * FROM promotions WHERE venue_id = ? ORDER BY id DESC').all(req.user.venue_id)));
  app.post('/api/v1/promotions', auth('promotions.write'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name || !['special_price', 'percentage_discount', 'buy_x_get_y', 'bundle', 'free_item'].includes(b.promotion_type)) return sendError(res, 400, 'VALIDATION', 'Tipo de promoción no válido.');
      const r = db.prepare(`INSERT INTO promotions (venue_id, name, promotion_type, product_id, percent_off_bps, buy_x, get_y, starts_at, ends_at, is_active) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.venue_id, b.name, b.promotion_type, b.product_id || null, b.percent_off_bps || null, b.buy_x || null, b.get_y || null, b.starts_at || null, b.ends_at || null, b.is_active === undefined ? 1 : Number(b.is_active));
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'promotion.created', entityType: 'promotion', entityId: Number(r.lastInsertRowid) });
      sendOk(res, { id: Number(r.lastInsertRowid) }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.patch('/api/v1/promotions/:id', auth('promotions.write'), (req, res) => {
    try {
      const b = req.body || {};
      const sets = [], vals = [];
      for (const k of ['name', 'is_active', 'starts_at', 'ends_at', 'percent_off_bps', 'buy_x', 'get_y']) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
      if (sets.length) db.prepare(`UPDATE promotions SET ${sets.join(', ')} WHERE id = ? AND venue_id = ?`).run(...vals, req.params.id, req.user.venue_id);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'promotion.updated', entityType: 'promotion', entityId: req.params.id });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  app.get('/api/v1/coupons', auth('menu.read'), (req, res) => {
    const rows = db.prepare('SELECT * FROM coupons WHERE venue_id = ? ORDER BY id DESC').all(req.user.venue_id).map((c) => {
      const used = db.prepare('SELECT COUNT(*) n FROM coupon_redemptions WHERE coupon_id = ?').get(c.id).n;
      return { ...c, used_count: used };
    });
    sendOk(res, rows);
  });
  app.post('/api/v1/coupons', auth('coupons.write'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.code || ![ 'percent', 'fixed'].includes(b.discount_type) || !Number(b.discount_value)) return sendError(res, 400, 'VALIDATION', 'Código, tipo y valor del cupón son obligatorios.');
      const r = db.prepare(`INSERT INTO coupons (venue_id, code, discount_type, discount_value, minimum_order_minor, maximum_discount_minor, starts_at, ends_at, total_usage_limit, customer_usage_limit, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(req.user.venue_id, String(b.code).trim().toUpperCase(), b.discount_type, Number(b.discount_value), Number(b.minimum_order_minor) || 0, b.maximum_discount_minor == null ? null : Number(b.maximum_discount_minor), b.starts_at || null, b.ends_at || null, b.total_usage_limit == null ? null : Number(b.total_usage_limit), b.customer_usage_limit == null ? null : Number(b.customer_usage_limit), b.is_active === undefined ? 1 : Number(b.is_active));
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'coupon.created', entityType: 'coupon', entityId: Number(r.lastInsertRowid) });
      sendOk(res, { id: Number(r.lastInsertRowid) }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.patch('/api/v1/coupons/:id', auth('coupons.write'), (req, res) => {
    try {
      const b = req.body || {};
      const sets = [], vals = [];
      for (const k of ['is_active', 'starts_at', 'ends_at', 'total_usage_limit', 'customer_usage_limit']) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
      if (sets.length) db.prepare(`UPDATE coupons SET ${sets.join(', ')} WHERE id = ? AND venue_id = ?`).run(...vals, req.params.id, req.user.venue_id);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'coupon.updated', entityType: 'coupon', entityId: req.params.id });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- RESERVAS ----------
  app.get('/api/v1/reservations', auth('reservations.read'), (req, res) => {
    const q = req.query || {};
    let sql = 'SELECT * FROM reservations WHERE venue_id = ?';
    const vals = [req.user.venue_id];
    if (q.status) { sql += ' AND status = ?'; vals.push(q.status); }
    if (q.date === 'today') sql += ' AND datetime >= date(\'now\') AND datetime < date(\'now\',\'+1 day\')';
    if (q.date === 'upcoming') { sql += ' AND datetime >= ? AND status IN (\'pending\',\'confirmed\')'; vals.push(nowISO()); }
    sql += ' ORDER BY datetime LIMIT 200';
    sendOk(res, db.prepare(sql).all(...vals));
  });
  app.post('/api/v1/reservations/:id/transition', auth('reservations.manage'), (req, res) => {
    try {
      const b = req.body || {};
      if (!['confirmed', 'attended', 'no_show', 'cancelled'].includes(b.status)) return sendError(res, 400, 'VALIDATION', 'Estado no válido.');
      const r = db.prepare('SELECT * FROM reservations WHERE id = ? AND venue_id = ?').get(req.params.id, req.user.venue_id);
      if (!r) return sendError(res, 404, 'NOT_FOUND', 'Reserva no encontrada.');
      db.prepare(`UPDATE reservations SET status = ?, updated_at = ? WHERE id = ?`).run(b.status, nowISO(), r.id);
      db.prepare(`INSERT INTO reservation_status_history (reservation_id, venue_id, status, actor_user_id) VALUES (?,?,?,?)`).run(r.id, req.user.venue_id, b.status, req.user.id);
      if (b.status === 'confirmed') enqueueOutbox(db, { venueId: req.user.venue_id, eventType: 'reservation_confirmed', entityType: 'reservation', entityId: r.id, payload: { to: r.phone } });
      audit(db, { venueId: req.user.venue_id, user: req.user, action: `reservation.${b.status}`, entityType: 'reservation', entityId: r.id, before: { status: r.status } });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.get('/api/v1/reservation-settings', auth('reservations.manage'), (req, res) => {
    const s = db.prepare('SELECT * FROM reservation_settings WHERE venue_id = ?').get(req.user.venue_id);
    sendOk(res, s || {});
  });
  app.patch('/api/v1/reservation-settings', auth('reservations.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const s = db.prepare('SELECT * FROM reservation_settings WHERE venue_id = ?').get(req.user.venue_id);
      const sets = [], vals = [];
      for (const k of ['opening_time', 'closing_time', 'slot_minutes', 'max_party_size', 'min_advance_minutes', 'max_advance_days', 'capacity_per_slot', 'available_days_json']) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
      if (sets.length) { if (s) db.prepare(`UPDATE reservation_settings SET ${sets.join(', ')} WHERE venue_id = ?`).run(...vals, req.user.venue_id); else { db.prepare(`INSERT INTO reservation_settings (venue_id, ${sets.map((x) => x.split(' ')[0]).join(', ')}) VALUES (?${', ?'.repeat(sets.length)})`).run(req.user.venue_id, ...vals); } }
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'reservation.settings_updated', entityType: 'venue', entityId: req.user.venue_id });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- RESEÑAS ----------
  app.get('/api/v1/reviews', auth('reviews.read'), (req, res) => {
    const feedback = db.prepare('SELECT * FROM private_feedback WHERE venue_id = ? ORDER BY id DESC LIMIT 100').all(req.user.venue_id);
    const points = db.prepare('SELECT * FROM review_points WHERE venue_id = ? ORDER BY id').all(req.user.venue_id);
    const requests = db.prepare(`SELECT r.*, o.id AS order_number, o.customer_name FROM review_requests r JOIN orders o ON o.id = r.order_id WHERE r.venue_id = ? ORDER BY r.id DESC LIMIT 100`).all(req.user.venue_id);
    const google = db.prepare('SELECT review_url, connected_at FROM google_connections WHERE venue_id = ?').get(req.user.venue_id);
    const stats = {
      total_feedback: feedback.length, avg_rating: feedback.filter((f) => f.rating).length ? (feedback.filter((f) => f.rating).reduce((a, f) => a + f.rating, 0) / feedback.filter((f) => f.rating).length).toFixed(1) : null,
      points_opened: points.reduce((a, p) => a + (p.opened_count || 0), 0),
      requests_sent: requests.filter((r2) => ['sent', 'opened'].includes(r2.status)).length,
      requests_opened: requests.filter((r2) => r2.status === 'opened').length,
      top_point: points.sort((a, b) => b.opened_count - a.opened_count)[0] || null,
    };
    sendOk(res, { feedback, points, requests, google_connection: google, stats });
  });
  app.post('/api/v1/reviews/points', auth('reviews.manage'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.name) return sendError(res, 400, 'VALIDATION', 'Nombre del punto obligatorio.');
      checkTrial(db, req.user.venue_id);
      const max = feature(db, req.user.venue_id, 'reviews.points.max');
      const count = db.prepare('SELECT COUNT(*) n FROM review_points WHERE venue_id = ?').get(req.user.venue_id).n;
      if (max !== -1 && count >= max) return sendError(res, 403, 'PLAN_LIMIT', `Tu plan permite máximo ${max} puntos de reseña.`);
      const token = secureToken(8);
      const base = b.destination_url || 'https://search.google.com/local/writereview?placeid=DEMO';
      const r = db.prepare(`INSERT INTO review_points (venue_id, name, token, type, destination_url, is_active) VALUES (?,?,?,?,?,?)`).run(req.user.venue_id, b.name, token, b.type || 'counter', base, b.is_active === undefined ? 1 : Number(b.is_active));
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'reviews.point_created', entityType: 'review_point', entityId: Number(r.lastInsertRowid) });
      sendOk(res, { id: Number(r.lastInsertRowid), token, url: `/r/${token}` }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.patch('/api/v1/reviews/points/:id', auth('reviews.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const sets = [], vals = [];
      for (const k of ['name', 'is_active', 'destination_url', 'type']) if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
      if (sets.length) db.prepare(`UPDATE review_points SET ${sets.join(', ')} WHERE id = ? AND venue_id = ?`).run(...vals, req.params.id, req.user.venue_id);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'reviews.point_updated', entityType: 'review_point', entityId: req.params.id });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.post('/api/v1/reviews/google-link', auth('reviews.manage'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.review_url) return sendError(res, 400, 'VALIDATION', 'Pega la URL de reseña de Google.');
      db.prepare(`INSERT INTO google_connections (venue_id, review_url, set_by_user_id, connected_at) VALUES (?,?,?,?) ON CONFLICT(venue_id) DO UPDATE SET review_url = excluded.review_url, set_by_user_id = excluded.set_by_user_id, connected_at = excluded.connected_at`)
        .run(req.user.venue_id, b.review_url, req.user.id, nowISO());
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'reviews.google_link_updated', entityType: 'venue', entityId: req.user.venue_id });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- ANALÍTICA ----------
  app.get('/api/v1/analytics/summary', auth('analytics.read'), (req, res) => {
    const from = req.query?.from || new Date(Date.now() - 7 * 864e5).toISOString();
    const to = req.query?.to || nowISO();
    const vid = req.user.venue_id;
    const base = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status!='cancelled' AND payment_status!='unpaid' AND payment_status!='failed' THEN total_minor ELSE 0 END),0) revenue,
      COALESCE(SUM(CASE WHEN status!='cancelled' THEN total_minor ELSE 0 END),0) gross FROM orders WHERE venue_id = ? AND placed_at BETWEEN ? AND ?`).get(vid, from, to);
    const completed = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN payment_status IN ('paid','refunded','partially_refunded') THEN total_minor ELSE 0 END),0) revenue FROM orders WHERE venue_id = ? AND status='completed' AND placed_at BETWEEN ? AND ?`).get(vid, from, to);
    const byDay = db.prepare(`SELECT substr(placed_at,1,10) day, COUNT(*) orders, COALESCE(SUM(CASE WHEN status!='cancelled' THEN total_minor ELSE 0 END),0) revenue FROM orders WHERE venue_id = ? AND placed_at BETWEEN ? AND ? GROUP BY day ORDER BY day`).all(vid, from, to);
    const byPayment = db.prepare(`SELECT payment_status, COUNT(*) n, COALESCE(SUM(CASE WHEN status!='cancelled' THEN total_minor ELSE 0 END),0) s FROM orders WHERE venue_id = ? AND placed_at BETWEEN ? AND ? GROUP BY payment_status`).all(vid, from, to);
    const refunds = db.prepare('SELECT COALESCE(SUM(amount_minor),0) s, COUNT(*) n FROM refunds WHERE venue_id = ? AND created_at BETWEEN ? AND ?').get(vid, from, to);
    const top = db.prepare(`SELECT oi.name_snapshot name, SUM(oi.qty) qty, SUM(oi.line_total_minor) revenue FROM order_items oi WHERE oi.venue_id = ? AND oi.order_id IN (SELECT id FROM orders WHERE placed_at BETWEEN ? AND ? AND status != 'cancelled') GROUP BY oi.product_id ORDER BY qty DESC LIMIT 10`).all(vid, from, to);
    sendOk(res, {
      range: { from, to },
      today: db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status!='cancelled' THEN total_minor ELSE 0 END),0) revenue, COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END),0) cancelled FROM orders WHERE venue_id=? AND placed_at >= date('now')`).get(vid),
      totals: base,
      completed: { orders: completed.n, revenue: completed.revenue, avg_ticket_minor: completed.n ? Math.floor(completed.revenue / completed.n) : 0 },
      by_day: byDay, by_payment: byPayment, refunds,
      top_products: top,
      attention: attentionItems(db, vid),
      opportunities: opportunityItems(db, vid, from),
    });
  });
  app.get('/api/v1/analytics/customers-at-risk', auth('analytics.read'), (req, res) => {
    const rows = db.prepare(`SELECT id, name, normalized_phone, orders_count, total_spent_minor, last_order_at FROM customers WHERE venue_id = ? AND orders_count > 0 AND last_order_at < datetime('now','-30 days') ORDER BY last_order_at LIMIT 100`).all(req.user.venue_id);
    sendOk(res, rows);
  });
  app.get('/api/v1/analytics/top-products', auth('analytics.read'), (req, res) => {
    const rows = db.prepare(`SELECT oi.name_snapshot name, SUM(oi.qty) qty, SUM(oi.line_total_minor) revenue FROM order_items oi WHERE oi.venue_id = ? AND oi.order_id IN (SELECT id FROM orders WHERE status != 'cancelled') GROUP BY oi.product_id ORDER BY qty DESC LIMIT 20`).all(req.user.venue_id);
    sendOk(res, rows);
  });

  function attentionItems(db, vid) {
    const delayed = db.prepare(`SELECT COUNT(*) n FROM orders WHERE venue_id = ? AND status IN ('pending','accepted','preparing') AND placed_at < datetime('now','-30 minutes')`).get(vid).n;
    const noStock = db.prepare(`SELECT COUNT(*) n FROM menu_products WHERE venue_id = ? AND track_stock = 1 AND stock_quantity = 0 AND deleted_at IS NULL`).get(vid).n;
    const unanswered = db.prepare(`SELECT COUNT(*) n FROM private_feedback WHERE venue_id = ? AND comment = ''`).get(vid).n; // placeholder real: sin replies
    const subFail = db.prepare(`SELECT COUNT(*) n FROM subscription_payments sp JOIN subscriptions s ON s.id = sp.subscription_id WHERE s.venue_id = ? AND sp.status = 'failed'`).get(vid).n;
    return [
      { type: 'orders_delayed', count: delayed, message: delayed ? `${delayed} pedidos están demorados.` : null },
      { type: 'no_stock', count: noStock, message: noStock ? `${noStock} productos no tienen stock.` : null },
      { type: 'unanswered_reviews', count: unanswered, message: unanswered ? `${unanswered} comentarios sin respuesta.` : null },
      { type: 'subscription_failed', count: subFail, message: subFail ? `${subFail} pago de suscripción falló.` : null },
    ].filter((i) => i.count > 0);
  }
  function opportunityItems(db, vid, from) {
    const out = [];
    const tueDown = db.prepare(`SELECT day, AVG(revenue) avg FROM (SELECT strftime('%w', placed_at) day, COALESCE(SUM(CASE WHEN status!='cancelled' THEN total_minor ELSE 0 END),0) revenue FROM orders WHERE venue_id = ? AND placed_at > datetime('now','-28 days') GROUP BY date(placed_at)) GROUP BY day ORDER BY avg LIMIT 1`).get(vid);
    if (tueDown) out.push({ type: 'weak_day', message: `Tus ventas bajan los ${['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'][Number(tueDown.day)]}.` });
    const atRisk = db.prepare(`SELECT COUNT(*) n FROM customers WHERE venue_id = ? AND orders_count > 0 AND last_order_at < datetime('now','-30 days')`).get(vid).n;
    if (atRisk) out.push({ type: 'customers_at_risk', count: atRisk, message: `${atRisk} clientes no compran hace más de 30 días.` });
    const top = db.prepare(`SELECT name, opened_count FROM review_points WHERE venue_id = ? ORDER BY opened_count DESC LIMIT 1`).get(vid);
    if (top?.opened_count) out.push({ type: 'top_point', message: `El punto "${top.name}" recibe más interacciones.` });
    return out;
  }

  // ---------- BILLING ----------
  app.get('/api/v1/billing', auth('billing.manage'), (req, res) => {
    checkTrial(db, req.user.venue_id);
    const sub = db.prepare(`SELECT s.*, p.name plan_name, p.price_minor_monthly FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.venue_id = ? ORDER BY s.id DESC LIMIT 1`).get(req.user.venue_id);
    const invoices = db.prepare(`SELECT ip.* FROM subscription_payments ip JOIN subscriptions s ON s.id = ip.subscription_id WHERE s.venue_id = ? ORDER BY ip.id DESC LIMIT 12`).all(req.user.venue_id);
    const plans = db.prepare('SELECT * FROM plans ORDER BY sort').all().map((p) => ({ ...p, features: db.prepare('SELECT feature_key, value FROM plan_features WHERE plan_id = ?').all(p.id) }));
    const overrides = db.prepare('SELECT feature_key, value FROM organization_feature_overrides WHERE venue_id = ?').all(req.user.venue_id);
    sendOk(res, { subscription: sub, invoices, plans, overrides, features: featuresOf(db, req.user.venue_id) });
  });
  app.post('/api/v1/billing/checkout', auth('billing.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(b.plan_id);
      if (!plan) return sendError(res, 400, 'VALIDATION', 'Plan no válido.');
      const sub = db.prepare('SELECT * FROM subscriptions WHERE venue_id = ? ORDER BY id DESC LIMIT 1').get(req.user.venue_id);
      const now = nowISO();
      const periodEnd = new Date(Date.now() + 31 * 864e5).toISOString();
      let sid = sub?.id;
      if (sub) {
        db.prepare(`UPDATE subscriptions SET plan_id=?, status='active', cancel_at_period_end=0, current_period_start=?, current_period_end=?, updated_at=? WHERE id=?`).run(plan.id, now, periodEnd, now, sub.id);
      } else {
        const r = db.prepare(`INSERT INTO subscriptions (venue_id, plan_id, status, current_period_start, current_period_end) VALUES (?,?,'active',?,?)`).run(req.user.venue_id, plan.id, now, periodEnd);
        sid = Number(r.lastInsertRowid);
      }
      db.prepare(`INSERT INTO subscription_events (subscription_id, venue_id, event_type, payload_json) VALUES (?,?,?,?)`).run(sid, req.user.venue_id, 'subscription_activated', JSON.stringify({ plan: plan.id }));
      if (plan.price_minor_monthly > 0) {
        db.prepare(`INSERT INTO subscription_payments (subscription_id, venue_id, amount_minor, status, external_ref) VALUES (?,?,?,'succeeded','mock_inv_' || ?)`).run(sid, req.user.venue_id, plan.price_minor_monthly, Date.now());
      }
      enqueueOutbox(db, { venueId: req.user.venue_id, eventType: 'subscription_activated', entityType: 'subscription', entityId: sid, payload: { to: req.user.email } });
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'billing.plan_changed', entityType: 'subscription', entityId: sid, before: { plan: sub?.plan_id }, after: { plan: plan.id } });
      sendOk(res, { subscription_id: sid, plan: plan.id, status: 'active' });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.post('/api/v1/billing/cancel', auth('billing.cancel'), (req, res) => {
    try {
      const sub = db.prepare('SELECT * FROM subscriptions WHERE venue_id = ? ORDER BY id DESC LIMIT 1').get(req.user.venue_id);
      if (!sub) return sendError(res, 404, 'NOT_FOUND', 'Sin suscripción.');
      db.prepare(`UPDATE subscriptions SET cancel_at_period_end = 1, updated_at = ? WHERE id = ?`).run(nowISO(), sub.id);
      db.prepare(`INSERT INTO subscription_events (subscription_id, venue_id, event_type) VALUES (?,?,'subscription_cancelled')`).run(sub.id, req.user.venue_id);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'billing.cancelled', entityType: 'subscription', entityId: sub.id });
      sendOk(res, { cancel_at_period_end: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.post('/api/v1/billing/retry', auth('billing.manage'), (req, res) => {
    try {
      const sub = db.prepare('SELECT * FROM subscriptions WHERE venue_id = ? ORDER BY id DESC LIMIT 1').get(req.user.venue_id);
      if (!sub) return sendError(res, 404, 'NOT_FOUND', 'Sin suscripción.');
      db.prepare(`UPDATE subscriptions SET status='active', updated_at=? WHERE id=?`).run(nowISO(), sub.id);
      db.prepare(`INSERT INTO subscription_events (subscription_id, venue_id, event_type) VALUES (?,?,'payment_retried')`).run(sub.id, req.user.venue_id);
      sendOk(res, { status: 'active' });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- EQUIPO ----------
  app.get('/api/v1/team', auth('team.manage'), (req, res) => sendOk(res, db.prepare('SELECT id, email, name, phone, role, active, last_login_at, created_at FROM users WHERE venue_id = ? ORDER BY id').all(req.user.venue_id)));
  app.post('/api/v1/team', auth('team.manage'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.email || !b.name || !['manager', 'kitchen', 'cashier', 'marketing', 'viewer'].includes(b.role)) return sendError(res, 400, 'VALIDATION', 'Correo, nombre y rol válidos son obligatorios.');
      const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(b.email);
      if (exists) return sendError(res, 409, 'EMAIL_TAKEN', 'Ya existe un usuario con ese correo.');
      const count = db.prepare('SELECT COUNT(*) n FROM users WHERE venue_id = ?').get(req.user.venue_id).n;
      const max = feature(db, req.user.venue_id, 'staff.max');
      if (max !== -1 && count >= max) return sendError(res, 403, 'PLAN_LIMIT', `Tu plan permite máximo ${max} miembros.`);
      const tempPass = secureToken(6).slice(0, 10);
      const r = db.prepare(`INSERT INTO users (venue_id, email, name, phone, password_hash, role) VALUES (?,?,?,?,?,?)`).run(req.user.venue_id, b.email, b.name, b.phone || null, hashPassword(tempPass), b.role);
      enqueueOutbox(db, { venueId: req.user.venue_id, eventType: 'staff_invitation', entityType: 'user', entityId: Number(r.lastInsertRowid), payload: { to: b.email, name: b.name } });
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'team.member_created', entityType: 'user', entityId: Number(r.lastInsertRowid), after: { email: b.email, role: b.role } });
      sendOk(res, { id: Number(r.lastInsertRowid), temp_password: tempPass }, 201);
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.patch('/api/v1/team/:id', auth('team.manage'), (req, res) => {
    try {
      const b = req.body || {};
      const target = db.prepare('SELECT id, role, active FROM users WHERE id = ? AND venue_id = ?').get(req.params.id, req.user.venue_id);
      if (!target) return sendError(res, 404, 'NOT_FOUND', 'Miembro no encontrado.');
      const sets = [], vals = [];
      const allowedRoles = ['manager', 'kitchen', 'cashier', 'marketing', 'viewer'];
      if (b.role !== undefined) {
        if (!allowedRoles.includes(b.role)) return sendError(res, 400, 'VALIDATION', 'Rol no válido para un miembro del equipo.');
        if (String(req.params.id) === String(req.user.id)) return sendError(res, 409, 'SELF_ROLE_CHANGE', 'No puedes cambiar tu propio rol.');
        sets.push('role = ?'); vals.push(b.role);
      }
      if (b.active !== undefined) {
        if (![0, 1, true, false].includes(b.active)) return sendError(res, 400, 'VALIDATION', 'Estado activo no válido.');
        sets.push('active = ?'); vals.push(b.active ? 1 : 0);
      }
      if (sets.length) db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ? AND venue_id = ?`).run(...vals, req.params.id, req.user.venue_id);
      audit(db, { venueId: req.user.venue_id, user: req.user, action: 'team.member_updated', entityType: 'user', entityId: req.params.id, after: b });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });

  // ---------- AUDITORÍA ----------
  app.get('/api/v1/audit', auth('audit.read'), (req, res) => {
    const q = req.query || {};
    let sql = 'SELECT * FROM audit_logs WHERE venue_id = ?';
    const vals = [req.user.venue_id];
    if (q.entity_type) { sql += ' AND entity_type = ?'; vals.push(q.entity_type); }
    if (q.action) { sql += ' AND action LIKE ?'; vals.push(`%${q.action}%`); }
    if (q.from) { sql += ' AND created_at >= ?'; vals.push(q.from); }
    if (q.to) { sql += ' AND created_at <= ?'; vals.push(q.to); }
    sql += ' ORDER BY id DESC LIMIT 300';
    sendOk(res, db.prepare(sql).all(...vals));
  });

  // ---------- SUPERADMIN (platform_admin) ----------
  app.get('/api/v1/admin/venues', auth('admin.manage'), (req, res) => {
    const rows = db.prepare(`SELECT v.id, v.name, v.slug, v.status, v.created_at, s.plan_id, s.status sub_status, s.trial_ends_at,
      (SELECT COUNT(*) FROM orders o WHERE o.venue_id = v.id) orders_count FROM venues v LEFT JOIN subscriptions s ON s.id = (SELECT id FROM subscriptions WHERE venue_id = v.id ORDER BY id DESC LIMIT 1) ORDER BY v.id`).all();
    sendOk(res, rows);
  });
  app.patch('/api/v1/admin/venues/:id/status', auth('admin.manage'), (req, res) => {
    try {
      const b = req.body || {};
      if (!['active', 'suspended'].includes(b.status)) return sendError(res, 400, 'VALIDATION', 'Estado no válido.');
      const v = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id);
      if (!v) return sendError(res, 404, 'NOT_FOUND', 'Negocio no encontrado.');
      db.prepare('UPDATE venues SET status = ?, updated_at = ? WHERE id = ?').run(b.status, nowISO(), v.id);
      audit(db, { venueId: v.id, user: req.user, action: 'admin.venue_status', entityType: 'venue', entityId: v.id, before: { status: v.status }, after: { status: b.status } });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.get('/api/v1/admin/outbox-failures', auth('admin.manage'), (req, res) => {
    const rows = db.prepare(`SELECT oe.*, v.name venue_name FROM outbox_events oe LEFT JOIN venues v ON v.id = oe.venue_id WHERE oe.status = 'failed' ORDER BY oe.id DESC LIMIT 100`).all();
    sendOk(res, rows);
  });
  app.post('/api/v1/admin/venues/:id/overrides', auth('admin.manage'), (req, res) => {
    try {
      const b = req.body || {};
      if (!b.feature_key) return sendError(res, 400, 'VALIDATION', 'feature_key obligatorio.');
      db.prepare(`INSERT INTO organization_feature_overrides (venue_id, feature_key, value, created_by_user_id) VALUES (?,?,?,?)
        ON CONFLICT DO NOTHING`).run(req.params.id, b.feature_key, String(b.value), req.user.id);
      db.prepare(`UPDATE organization_feature_overrides SET value = ? WHERE venue_id = ? AND feature_key = ?`).run(String(b.value), req.params.id, b.feature_key);
      audit(db, { venueId: Number(req.params.id), user: req.user, action: 'admin.feature_override', entityType: 'venue', entityId: req.params.id, after: { feature_key: b.feature_key, value: b.value } });
      sendOk(res, { updated: true });
    } catch (e) { const h = errToHttp(e); sendError(res, h.status, h.code, h.message); }
  });
  app.get('/api/v1/admin/audit', auth('admin.manage'), (req, res) => {
    const rows = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300').all();
    sendOk(res, rows);
  });
  app.get('/api/v1/admin/metrics', auth('admin.manage'), (req, res) => sendOk(res, apiMetrics.snapshot()));
}

// ---------- helpers ----------
function venueBrief(db, vid) {
  const v = db.prepare('SELECT id, name, slug FROM venues WHERE id = ?').get(vid);
  return v || null;
}
function spotlight(v) {
  const { opening_hours_json, updated_at, ...rest } = v;
  return { ...rest };
}
function onboardingState(db, v) {
  const cats = db.prepare('SELECT COUNT(*) n FROM menu_categories WHERE venue_id = ? AND deleted_at IS NULL').get(v.id).n;
  const prods = db.prepare('SELECT COUNT(*) n FROM menu_products WHERE venue_id = ? AND deleted_at IS NULL').get(v.id).n;
  return {
    business_data: !!(v.name && v.phone),
    hours: !!(v.opening_hours_json && v.opening_hours_json !== 'null'),
    branding: !!(v.logo_emoji || v.branding_color),
    first_category: cats > 0,
    first_product: prods > 0,
    delivery_method: !!(v.pickup_enabled || v.delivery_enabled),
    menu_published: prods > 0,
    qr_downloaded: false, // se marca desde UI al descargar QR
  };
}
function sessionCookie(token) {
  return `ros_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${config.sessionTtlDays * 86400}${config.env === 'production' ? '; Secure' : ''}`;
}
