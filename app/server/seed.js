// Restaurant OS — seed de datos demo (idempotente: no duplica si el venue existe)
import { hashPassword, createSession } from './auth.js';
import { nowISO, openDb } from './db.js';
import { pathToFileURL } from 'node:url';
import { DEFAULT_FEATURES } from './entitlements.js';

const T = (days = 7) => new Date(Date.now() + days * 864e5).toISOString();
const YESTERDAY = () => new Date(Date.now() - 1 * 864e5).toISOString();

export async function seed(db) {
  const exists = db.prepare('SELECT id FROM venues WHERE slug = ?').get('casa-aurora');
  if (exists) return;

  // ---- planes y features ----
  const insFeature = db.prepare('INSERT OR IGNORE INTO features (key, description) VALUES (?,?)');
  for (const k of Object.keys(DEFAULT_FEATURES.starter)) insFeature.run(k, k);
  const plans = [
    ['starter', 'Starter', 0, 0],
    ['plus', 'Plus', 4900, 1],
    ['pro', 'Pro', 9900, 2],
  ];
  for (const [id, name, price, sort] of plans) {
    db.prepare('INSERT OR IGNORE INTO plans (id, name, price_minor_monthly, trial_days, sort) VALUES (?,?,?,7,?)').run(id, name, price, sort);
    const pf = db.prepare('INSERT OR IGNORE INTO plan_features (plan_id, feature_key, value) VALUES (?,?,?)');
    for (const [k, v] of Object.entries(DEFAULT_FEATURES[id])) pf.run(id, k, String(v));
  }

  // ---- Casa Aurora (Pro trial) ----
  const vid = insertVenue(db, {
    organization_id: 'ORG-CASA-01', location_id: 'ORG-CASA-01-L1', name: 'Casa Aurora', slug: 'casa-aurora',
    business_type: 'restaurante', phone: '+51999100100', whatsapp: '+51999100100', email: 'hola@casaaurora.pe',
    address: 'Av. Larco 180', district: 'Miraflores', city: 'Lima', lat: -12.119, lng: -77.028,
    branding_color: '#A3542F', logo_emoji: '🌻', cover_emoji: '🌿', instagram: 'casaaurora.pe',
    opening_hours_json: JSON.stringify({ 1: { open: '12:00', close: '22:00' }, 2: { open: '12:00', close: '22:00' }, 3: { open: '12:00', close: '22:00' }, 4: { open: '12:00', close: '22:00' }, 5: { open: '12:00', close: '23:00' }, 6: { open: '12:00', close: '23:00' }, 7: { open: '13:00', close: '22:00' } }),
    enforce_opening_hours: 0, flat_delivery_fee_minor: 500, pickup_enabled: 1, delivery_enabled: 1,
  });
  db.prepare(`INSERT INTO subscriptions (venue_id, plan_id, status, trial_ends_at, current_period_start, current_period_end) VALUES (?, 'pro','trialing',?,?,?)`).run(vid, T(7), nowISO(), T(31));
  db.prepare(`INSERT INTO reservation_settings (venue_id, opening_time, closing_time, max_party_size, min_advance_minutes, max_advance_days, capacity_per_slot) VALUES (?, '12:00','22:00',8,60,30,20)`).run(vid);
  db.prepare(`INSERT INTO google_connections (venue_id, review_url, connected_at) VALUES (?, 'https://search.google.com/local/writereview?placeid=DEMO-CASA', ?)`).run(vid, nowISO());

  const ownerId = insertUser(db, vid, 'owner@casaaurora.pe', 'Marta Ríos', 'owner', 'Demo1234!');
  insertUser(db, vid, 'cocina@casaaurora.pe', 'José Quispe', 'kitchen', 'Demo1234!');
  insertUser(db, vid, 'caja@casaaurora.pe', 'Lucía Torres', 'cashier', 'Demo1234!');
  insertUser(db, vid, 'marketing@casaaurora.pe', 'Diego Luna', 'marketing', 'Demo1234!');

  // menú
  const cats = {};
  for (const [name, emoji] of [['Entradas', '🥗'], ['Principales', '🍛'], ['Postres', '🍮'], ['Bebidas', '🥤']]) {
    const r = db.prepare(`INSERT INTO menu_categories (venue_id, name, sort_order) VALUES (?,?,?)`).run(vid, name, Object.keys(cats).length);
    cats[name] = Number(r.lastInsertRowid);
  }
  const products = [
    ['Ceviche Clásico', 'Pescado fresco marinado en limón, cebolla roja, camote y choclo.', 2800, null, 10, 1, '🍋', cats.Entradas, 20],
    ['Papa a la Huancaína', 'Papas doradas con crema de ají amarillo y queso.', 1800, null, 15, 0, '🥔', cats.Entradas, 10],
    ['Lomo Saltado', 'Lomo salteado con cebolla, tomate, papas fritas y arroz.', 3200, 2800, 50, 1, '🥩', cats.Principales, 25],
    ['Arroz con Pollo', 'Arroz verde con pollo, culantro y salsa criolla.', 2600, null, 10, 0, '🍗', cats.Principales, 25],
    ['Ají de Gallina', 'Pollo deshilachado en crema de ají amarillo, arroz y papa.', 2400, null, 8, 0, '🍛', cats.Principales, 20],
    ['Chaufa de Pollo', 'Arroz chaufa criollo con pollo y verduras.', 2500, null, 10, 0, '🍚', cats.Principales, 20],
    ['Hamburguesa Clásica', 'Carne 100% de res, queso, lechuga, tomate y salsa de la casa.', 2200, null, 20, 1, '🍔', cats.Principales, 15],
    ['Suspiro a la Limeña', 'Dulce de leche con merengue y canela.', 1200, null, 0, 0, '🍮', cats.Postres, 5],
    ['Helado de Lúcuma', 'Helado artesanal de lúcuma.', 900, null, 0, 0, '🍨', cats.Postres, 5],
    ['Chicha Morada', 'Chicha morada artesanal bien fría.', 800, null, 0, 0, '🍹', cats.Bebidas, 3],
    ['Café de Especialidad', 'Origen San Ignacio, método filtrado.', 700, null, 0, 0, '☕', cats.Bebidas, 8],
  ];
  const prodIds = {};
  for (const [name, desc, price, promo, stock, featured, emoji, cat, prep] of products) {
    const r = db.prepare(`INSERT INTO menu_products (venue_id, category_id, name, description, price_minor, promo_price_minor, track_stock, stock_quantity, is_available, is_visible, is_featured, preparation_time_minutes, emoji) VALUES (?,?,?,?,?,?,?,?,1,1,?,?,?)`)
      .run(vid, cat, name, desc, price, promo, stock > 0 ? 1 : 0, stock, featured, prep, emoji);
    prodIds[name] = Number(r.lastInsertRowid);
  }
  // opciones: Tamaño (Hamburguesa) y Extras (Lomo)
  const gr1 = db.prepare(`INSERT INTO option_groups (venue_id, name, is_required, selection_type, min_selections, max_selections) VALUES (?, 'Tamaño', 1, 'single', 1, 1)`).run(vid);
  const g1 = Number(gr1.lastInsertRowid);
  const o1a = db.prepare(`INSERT INTO options (option_group_id, venue_id, name, price_minor, sort_order) VALUES (?,?,'Simple',0,1)`).run(g1, vid);
  db.prepare(`INSERT INTO options (option_group_id, venue_id, name, price_minor, sort_order) VALUES (?,?,'Doble',600,2)`).run(g1, vid);
  db.prepare(`INSERT INTO product_option_groups (product_id, option_group_id) VALUES (?,?)`).run(prodIds['Hamburguesa Clásica'], g1);
  const gr2 = db.prepare(`INSERT INTO option_groups (venue_id, name, is_required, selection_type, min_selections, max_selections) VALUES (?, 'Extras', 0, 'multiple', 0, 3)`).run(vid);
  const g2 = Number(gr2.lastInsertRowid);
  db.prepare(`INSERT INTO options (option_group_id, venue_id, name, price_minor, sort_order) VALUES (?,?,'Huevo frito',200,1)`).run(g2, vid);
  db.prepare(`INSERT INTO options (option_group_id, venue_id, name, price_minor, sort_order) VALUES (?,?,'Adicional papas',400,2)`).run(g2, vid);
  db.prepare(`INSERT INTO product_option_groups (product_id, option_group_id) VALUES (?,?)`).run(prodIds['Lomo Saltado'], g2);

  // promociones y cupones
  db.prepare(`INSERT INTO promotions (venue_id, name, promotion_type, product_id, percent_off_bps, buy_x, get_y, is_active) VALUES (?, 'Precio del día: Lomo','special_price',?,NULL,NULL,NULL,1)`).run(vid, prodIds['Lomo Saltado']);
  db.prepare(`INSERT INTO promotions (venue_id, name, promotion_type, product_id, percent_off_bps, buy_x, get_y, is_active) VALUES (?, '2x1 Hamburguesas','buy_x_get_y',?,NULL,1,1,1)`).run(vid, prodIds['Hamburguesa Clásica']);
  db.prepare(`INSERT INTO coupons (venue_id, code, discount_type, discount_value, minimum_order_minor, maximum_discount_minor, total_usage_limit, customer_usage_limit, is_active) VALUES (?, 'BIENVENIDA10','percent',10,3000,1500,1000,1,1)`).run(vid);

  // delivery zones
  for (const [name, fee, min, mins] of [['Miraflores', 500, 2000, 30], ['San Isidro', 700, 2500, 35], ['Barranco', 600, 2000, 40]]) {
    db.prepare(`INSERT INTO delivery_zones (venue_id, name, delivery_fee_minor, minimum_order_minor, estimated_minutes, is_active) VALUES (?,?,?,?,?,1)`).run(vid, name, fee, min, mins);
  }

  // inventario
  const inv = {};
  for (const [name, unit, qty, reorder] of [['Lomo (kg)', 'kg', 20, 5], ['Papa (kg)', 'kg', 30, 10], ['Pollo (kg)', 'kg', 25, 8], ['Arroz (kg)', 'kg', 40, 15], ['Lechuga', 'unidad', 24, 10]]) {
    const r = db.prepare(`INSERT INTO inventory_items (venue_id, name, unit, qty_on_hand, reorder_level) VALUES (?,?,?,?,?)`).run(vid, name, unit, qty, reorder);
    inv[name] = Number(r.lastInsertRowid);
  }

  // review points
  db.prepare(`INSERT INTO review_points (venue_id, name, token, type, destination_url, is_active) VALUES (?, 'Caja principal','RPCAJA01','counter','https://search.google.com/local/writereview?placeid=DEMO-CASA',1)`).run(vid);
  db.prepare(`INSERT INTO review_points (venue_id, name, token, type, destination_url, is_active) VALUES (?, 'Mesa 01','RPMESA01','table','https://search.google.com/local/writereview?placeid=DEMO-CASA',1)`).run(vid);

  // cliente demo (rol customer + perfil)
  insertUser(db, vid, 'cliente@demo.pe', 'Elena Paredes', 'customer', 'Demo1234!');
  db.prepare(`INSERT OR IGNORE INTO customers (venue_id, normalized_phone, name, email) VALUES (?, '+51999100200', 'Elena Paredes', 'cliente@demo.pe')`).run(vid);

  // ---- La Cantina (Starter) ----
  const vid2 = insertVenue(db, {
    organization_id: 'ORG-CANT-01', location_id: 'ORG-CANT-01-L1', name: 'La Cantina', slug: 'la-cantina',
    business_type: 'hamburguesería', phone: '+51999100300', whatsapp: '+51999100300', email: 'hola@lacantina.pe',
    address: 'Jr. de la Unión 210', district: 'Cercado de Lima', city: 'Lima',
    branding_color: '#5B4636', logo_emoji: '🍔', flat_delivery_fee_minor: 0, pickup_enabled: 1, delivery_enabled: 0,
  });
  db.prepare(`INSERT INTO subscriptions (venue_id, plan_id, status, current_period_start, current_period_end) VALUES (?, 'starter','active',?,?)`).run(vid2, nowISO(), T(31));
  insertUser(db, vid2, 'owner@lacantina.pe', 'Renzo Flores', 'owner', 'Demo1234!');
  const cat2 = db.prepare(`INSERT INTO menu_categories (venue_id, name, sort_order) VALUES (?,'Hamburguesas',0)`).run(vid2);
  const c2 = Number(cat2.lastInsertRowid);
  db.prepare(`INSERT INTO menu_products (venue_id, category_id, name, description, price_minor, track_stock, stock_quantity, is_visible, emoji) VALUES (?,?,?,?,?,?,?,?,?)`).run(vid2, c2, 'Hamburguesa La Cantina', 'Carne de res, queso, tocino.', 1800, 1, 30, 1, '🍔');

  // ---- admin de plataforma ----
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(configAdmin())) {
    db.prepare(`INSERT INTO users (venue_id, email, name, password_hash, role) VALUES (NULL, ?, 'Admin Plataforma', ?, 'platform_admin')`).run(configAdmin(), hashPassword('Admin1234!'));
  }

  // ---- pedidos históricos demo (analítica con datos reales) ----
  const hist = db.prepare('SELECT id FROM customers WHERE venue_id = ? AND normalized_phone = ?').get(vid, '+51999100200');
  const d1 = YESTERDAY();
  const r1 = db.prepare(`INSERT INTO orders (venue_id, customer_id, customer_name, customer_phone, status, payment_status, fulfillment_type, subtotal_minor, tax_minor, discount_minor, delivery_fee_minor, total_minor, currency, idempotency_key, public_token, placed_at, completed_at) VALUES (?,?,?,?, 'completed','paid','pickup',?,?,?,?,?,'PEN',?,?,?,?)`)
    .run(vid, hist.id, 'Elena Paredes', '+51999100200', 3200, 576, 0, 0, 3776, 'hist-' + Date.now() + '-1', 'histtoken1', d1, d1);
  const oid1 = Number(r1.lastInsertRowid);
  db.prepare(`INSERT INTO order_items (order_id, venue_id, product_id, name_snapshot, unit_price_minor, qty, line_total_minor) VALUES (?,?,?,?,?,?,?)`).run(oid1, vid, prodIds['Lomo Saltado'], 'Lomo Saltado', 3200, 1, 3200);
  db.prepare(`INSERT INTO order_status_history (order_id, venue_id, status, actor_name) VALUES (?,?,'pending','Elena Paredes'),(?,?,'accepted','José Quispe'),(?,?,'preparing','José Quispe'),(?,?,'ready','José Quispe'),(?,?,'completed','Lucía Torres')`).run(oid1, vid, oid1, vid, oid1, vid, oid1, vid, oid1, vid);
  db.prepare(`INSERT INTO payments (order_id, venue_id, amount_minor, status, provider, external_ref) VALUES (?,?,?,'succeeded','mock','mock_hist_1')`).run(oid1, vid, 3776);
  db.prepare(`UPDATE customers SET orders_count = 2, total_spent_minor = 7552, average_ticket_minor = 3776, first_order_at = ?, last_order_at = ?, preferred_fulfillment_type = 'pickup' WHERE id = ?`).run(d1, d1, hist.id);
  const r2 = db.prepare(`INSERT INTO orders (venue_id, customer_id, customer_name, customer_phone, status, payment_status, fulfillment_type, subtotal_minor, tax_minor, discount_minor, delivery_fee_minor, total_minor, currency, idempotency_key, public_token, placed_at, cancelled_at) VALUES (?,?,?,?, 'cancelled','refunded','delivery',?,?,?,?,?,'PEN',?,?,?,?)`)
    .run(vid, hist.id, 'Elena Paredes', '+51999100200', 2600, 468, 500, 0, 3568, 'hist-' + Date.now() + '-2', 'histtoken2', d1, d1);
  const oid2 = Number(r2.lastInsertRowid);
  db.prepare(`INSERT INTO order_items (order_id, venue_id, product_id, name_snapshot, unit_price_minor, qty, line_total_minor) VALUES (?,?,?,?,?,?,?)`).run(oid2, vid, prodIds['Arroz con Pollo'], 'Arroz con Pollo', 2600, 1, 2600);
  db.prepare(`INSERT INTO payments (order_id, venue_id, amount_minor, status, provider, external_ref) VALUES (?,?,?,'refunded','mock','mock_hist_2')`).run(oid2, vid, 3568);
  db.prepare(`INSERT INTO refunds (payment_id, order_id, venue_id, amount_minor, reason) VALUES ((SELECT id FROM payments WHERE external_ref='mock_hist_2'), ?, ?, 3568, 'Cancelación de pedido')`).run(oid2, vid);

  console.log(`[seed] demo lista: Casa Aurora (vid=${vid}, owner: owner@casaaurora.pe / Demo1234!) · La Cantina (vid=${vid2}) · admin=${configAdmin()}`);
}

function insertVenue(db, v) {
  const r = db.prepare(`INSERT INTO venues (organization_id, location_id, name, slug, business_type, phone, whatsapp, email, address, district, city, lat, lng, branding_color, logo_emoji, cover_emoji, instagram, opening_hours_json, enforce_opening_hours, flat_delivery_fee_minor, pickup_enabled, delivery_enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(v.organization_id, v.location_id, v.name, v.slug, v.business_type, v.phone, v.whatsapp, v.email, v.address || null, v.district || null, v.city || 'Lima', v.lat ?? null, v.lng ?? null, v.branding_color || '#A3542F', v.logo_emoji || '🍽️', v.cover_emoji || '🌿', v.instagram || null, v.opening_hours_json || null, v.enforce_opening_hours || 0, v.flat_delivery_fee_minor ?? 0, v.pickup_enabled ?? 1, v.delivery_enabled ?? 0);
  return Number(r.lastInsertRowid);
}
function insertUser(db, venueId, email, name, role, password) {
  const r = db.prepare(`INSERT INTO users (venue_id, email, name, password_hash, role) VALUES (?,?,?,?,?)`).run(venueId, email, name, hashPassword(password), role);
  return Number(r.lastInsertRowid);
}
function configAdmin() { return process.env.ADMIN_EMAIL || 'admin@restaurantos.pe'; }

// ----- CLI: npm run seed (aplica migraciones + datos demo en config.dbPath) -----
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const db = openDb();
  try {
    await seed(db);
    console.log('[seed] datos demo listos.');
  } finally {
    db.close();
  }
}