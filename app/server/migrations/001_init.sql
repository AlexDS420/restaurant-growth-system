-- Restaurant OS — migración 001: esquema inicial
-- SQLite · dinero en minor units (PEN) · timestamps UTC ISO-8601 · soft delete en menú

CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  legal_name TEXT,
  business_type TEXT,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  district TEXT,
  city TEXT DEFAULT 'Lima',
  lat REAL,
  lng REAL,
  currency TEXT NOT NULL DEFAULT 'PEN',
  timezone TEXT NOT NULL DEFAULT 'America/Lima',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  enforce_opening_hours INTEGER NOT NULL DEFAULT 0,
  opening_hours_json TEXT,
  tax_rate_bps INTEGER NOT NULL DEFAULT 1800,
  branding_color TEXT DEFAULT '#A3542F',
  logo_emoji TEXT DEFAULT '🍽️',
  cover_emoji TEXT DEFAULT '🌿',
  instagram TEXT,
  facebook TEXT,
  pickup_enabled INTEGER NOT NULL DEFAULT 1,
  pickup_instructions TEXT,
  pickup_eta_minutes INTEGER DEFAULT 15,
  delivery_enabled INTEGER NOT NULL DEFAULT 1,
  flat_delivery_fee_minor INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER REFERENCES venues(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('platform_admin','owner','manager','kitchen','cashier','marketing','viewer','customer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_minor_monthly INTEGER NOT NULL DEFAULT 0,
  trial_days INTEGER NOT NULL DEFAULT 7,
  sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS features (
  key TEXT PRIMARY KEY,
  description TEXT
);

CREATE TABLE IF NOT EXISTS plan_features (
  plan_id TEXT NOT NULL REFERENCES plans(id),
  feature_key TEXT NOT NULL REFERENCES features(key),
  value TEXT NOT NULL,
  PRIMARY KEY (plan_id, feature_key)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  plan_id TEXT NOT NULL REFERENCES plans(id),
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing','active','past_due','cancelled','expired','suspended')),
  trial_ends_at TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS subscription_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS subscription_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS organization_feature_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  feature_key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS menu_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS menu_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  category_id INTEGER NOT NULL REFERENCES menu_categories(id),
  name TEXT NOT NULL,
  description TEXT,
  sku TEXT,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  promo_price_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'PEN',
  track_stock INTEGER NOT NULL DEFAULT 0,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_available INTEGER NOT NULL DEFAULT 1,
  is_visible INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  preparation_time_minutes INTEGER DEFAULT 15,
  emoji TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS option_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0,
  selection_type TEXT NOT NULL DEFAULT 'single' CHECK (selection_type IN ('single','multiple')),
  min_selections INTEGER NOT NULL DEFAULT 1,
  max_selections INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  option_group_id INTEGER NOT NULL REFERENCES option_groups(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  price_minor INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS product_option_groups (
  product_id INTEGER NOT NULL REFERENCES menu_products(id),
  option_group_id INTEGER NOT NULL REFERENCES option_groups(id),
  PRIMARY KEY (product_id, option_group_id)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  unit TEXT DEFAULT 'unidad',
  qty_on_hand REAL NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  reorder_level REAL DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  change_qty REAL NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('purchase','usage','adjustment','order_consume','order_cancel_restore')),
  order_id INTEGER,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  normalized_phone TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  orders_count INTEGER NOT NULL DEFAULT 0,
  total_spent_minor INTEGER NOT NULL DEFAULT 0,
  average_ticket_minor INTEGER NOT NULL DEFAULT 0,
  first_order_at TEXT,
  last_order_at TEXT,
  favorite_product_id INTEGER,
  preferred_fulfillment_type TEXT,
  marketing_consent INTEGER NOT NULL DEFAULT 0,
  consent_source TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT,
  UNIQUE (venue_id, normalized_phone)
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  address TEXT NOT NULL,
  reference TEXT,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS customer_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  note TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','preparing','ready','completed','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','pending','paid','failed','refunded','partially_refunded')),
  fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('pickup','delivery')),
  address TEXT,
  reference TEXT,
  delivery_zone_id INTEGER,
  scheduled_for TEXT,
  notes TEXT,
  subtotal_minor INTEGER NOT NULL DEFAULT 0,
  tax_minor INTEGER NOT NULL DEFAULT 0,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL DEFAULT 0,
  coupon_code TEXT,
  currency TEXT NOT NULL DEFAULT 'PEN',
  idempotency_key TEXT UNIQUE,
  public_token TEXT UNIQUE,
  placed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  product_id INTEGER NOT NULL,
  name_snapshot TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  line_total_minor INTEGER NOT NULL,
  options_json TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  status TEXT NOT NULL,
  note TEXT,
  actor_user_id INTEGER,
  actor_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  amount_minor INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','refunded','partially_refunded')),
  provider TEXT NOT NULL DEFAULT 'mock',
  external_ref TEXT UNIQUE,
  failure_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  reason TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS delivery_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  delivery_fee_minor INTEGER NOT NULL DEFAULT 0,
  minimum_order_minor INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER DEFAULT 30,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  promotion_type TEXT NOT NULL CHECK (promotion_type IN ('special_price','percentage_discount','buy_x_get_y','bundle','free_item')),
  product_id INTEGER,
  percent_off_bps INTEGER,
  buy_x INTEGER,
  get_y INTEGER,
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  code TEXT NOT NULL,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percent','fixed')),
  discount_value INTEGER NOT NULL,
  minimum_order_minor INTEGER NOT NULL DEFAULT 0,
  maximum_discount_minor INTEGER,
  starts_at TEXT,
  ends_at TEXT,
  total_usage_limit INTEGER,
  customer_usage_limit INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (venue_id, code)
);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id INTEGER NOT NULL REFERENCES coupons(id),
  order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  discount_minor INTEGER NOT NULL,
  customer_phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS review_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'counter' CHECK (type IN ('table','counter','delivery','packaging','staff')),
  destination_url TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  opened_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS review_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  review_point_id INTEGER,
  method TEXT NOT NULL CHECK (method IN ('manual','automatic')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','opened','failed','cancelled')),
  scheduled_for TEXT,
  sent_at TEXT,
  opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS review_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  review_point_id INTEGER,
  event_type TEXT NOT NULL CHECK (event_type IN ('opened','request_sent','request_opened')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS private_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  order_id INTEGER REFERENCES orders(id),
  customer_name TEXT,
  customer_phone TEXT,
  rating INTEGER,
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS google_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL UNIQUE REFERENCES venues(id),
  review_url TEXT,
  set_by_user_id INTEGER,
  connected_at TEXT
);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  public_token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  datetime TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','attended','no_show','cancelled')),
  comments TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS reservation_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL REFERENCES reservations(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  status TEXT NOT NULL,
  actor_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reservation_settings (
  venue_id INTEGER PRIMARY KEY REFERENCES venues(id),
  available_days_json TEXT,
  opening_time TEXT DEFAULT '12:00',
  closing_time TEXT DEFAULT '22:00',
  slot_minutes INTEGER DEFAULT 30,
  max_party_size INTEGER DEFAULT 8,
  min_advance_minutes INTEGER DEFAULT 60,
  max_advance_days INTEGER DEFAULT 30,
  capacity_per_slot INTEGER DEFAULT 20
);

CREATE TABLE IF NOT EXISTS outbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','processed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  processed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  session_id TEXT,
  event_name TEXT NOT NULL,
  actor_type TEXT,
  entity_type TEXT,
  entity_id TEXT,
  properties_json TEXT,
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  venue_id INTEGER,
  user_id INTEGER,
  user_email TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_venue_status ON orders(venue_id, status, placed_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_audit_venue ON audit_logs(venue_id, created_at);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox_events(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_customers_venue ON customers(venue_id);
CREATE INDEX IF NOT EXISTS idx_products_venue ON menu_products(venue_id, category_id);
CREATE INDEX IF NOT EXISTS idx_history_order ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_movements_item ON inventory_movements(inventory_item_id);
CREATE INDEX IF NOT EXISTS idx_reservations_venue ON reservations(venue_id, datetime);
CREATE INDEX IF NOT EXISTS idx_review_requests_order ON review_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_analytics_venue ON analytics_events(venue_id, occurred_at);