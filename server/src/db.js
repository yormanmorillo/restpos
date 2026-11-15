import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { FEATURE_KEYS, FEATURES, featureSettingKey } from '@restpos/shared/features';

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kitchen_stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT '#c45d3a',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0 AND price_cents <= 1000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  image_path TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS products_category_name_unique
  ON products(category_id, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS products_category_idx ON products(category_id, sort_order, name);

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 50),
  status TEXT NOT NULL DEFAULT 'libre' CHECK (status IN ('libre', 'ocupada')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  total_spent_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_spent_cents >= 0),
  visits INTEGER NOT NULL DEFAULT 0 CHECK (visits >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_search_idx ON customers(name, phone);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('mesa', 'llevar')),
  table_id INTEGER REFERENCES restaurant_tables(id),
  status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'pagada', 'anulada')),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  promotion_id INTEGER REFERENCES promotions(id) ON DELETE SET NULL,
  promotion_code TEXT NOT NULL DEFAULT '',
  loyalty_points_earned INTEGER NOT NULL DEFAULT 0,
  loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0,
  loyalty_awarded INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'percent', 'fixed')),
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  discount_reason TEXT NOT NULL DEFAULT '',
  tax_rate_bps INTEGER NOT NULL DEFAULT 1600 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  tip_type TEXT NOT NULL DEFAULT 'none' CHECK (tip_type IN ('none', 'percent', 'fixed')),
  tip_value INTEGER NOT NULL DEFAULT 0 CHECK (tip_value >= 0),
  precheck_tip_type TEXT,
  precheck_tip_value INTEGER,
  precheck_tip_cents INTEGER,
  tip_cents INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  payment_method TEXT,
  payment_method_name TEXT NOT NULL DEFAULT '',
  public_receipt_token TEXT UNIQUE,
  client_operation_id TEXT UNIQUE,
  cash_received_cents INTEGER CHECK (cash_received_cents IS NULL OR cash_received_cents >= 0),
  change_cents INTEGER CHECK (change_cents IS NULL OR change_cents >= 0),
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  cancelled_at TEXT,
  refunded_at TEXT,
  refund_cents INTEGER NOT NULL DEFAULT 0 CHECK (refund_cents >= 0),
  refund_reason TEXT NOT NULL DEFAULT '',
  CHECK (
    (type = 'mesa' AND table_id IS NOT NULL) OR
    (type = 'llevar' AND table_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_order_per_table
  ON orders(table_id) WHERE status = 'abierta' AND table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_status_business_date_idx
  ON orders(status, business_date);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_splits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  created_at TEXT NOT NULL,
  paid_at TEXT,
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS order_splits_order_idx ON order_splits(order_id);

CREATE TABLE IF NOT EXISTS order_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
  tip_type TEXT NOT NULL DEFAULT 'none' CHECK (tip_type IN ('none', 'percent', 'fixed')),
  tip_value INTEGER NOT NULL DEFAULT 0 CHECK (tip_value >= 0),
  tip_cents INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  delivery_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
  legacy_split_id INTEGER UNIQUE,
  public_receipt_token TEXT UNIQUE,
  created_at TEXT NOT NULL,
  paid_at TEXT,
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS order_checks_order_idx ON order_checks(order_id);

CREATE TABLE IF NOT EXISTS order_check_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL REFERENCES order_checks(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  created_at TEXT NOT NULL,
  UNIQUE (check_id, order_item_id)
);
CREATE INDEX IF NOT EXISTS order_check_lines_check_idx ON order_check_lines(check_id);
CREATE INDEX IF NOT EXISTS order_check_lines_item_idx ON order_check_lines(order_item_id);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  client_key TEXT NOT NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
  notes TEXT NOT NULL DEFAULT '',
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  sent_quantity INTEGER NOT NULL DEFAULT 0,
  station_id INTEGER REFERENCES kitchen_stations(id) ON DELETE SET NULL,
  prep_seconds INTEGER NOT NULL DEFAULT 0,
  split_id INTEGER REFERENCES order_splits(id) ON DELETE SET NULL,
  check_id INTEGER REFERENCES order_checks(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS order_items_client_key_unique
  ON order_items(order_id, client_key);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id, sort_order);
`;

const OPERATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'cashier', 'server', 'kitchen')),
  pin_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS staff_active_idx ON staff(active, name);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_staff_idx ON sessions(staff_id);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  opened_by_staff_id INTEGER NOT NULL REFERENCES staff(id),
  closed_by_staff_id INTEGER REFERENCES staff(id),
  opening_cents INTEGER NOT NULL DEFAULT 0 CHECK (opening_cents >= 0),
  counted_cents INTEGER CHECK (counted_cents IS NULL OR counted_cents >= 0),
  expected_cents INTEGER NOT NULL DEFAULT 0,
  difference_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS shifts_one_open ON shifts(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS shifts_opened_at_idx ON shifts(opened_at);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
  value INTEGER NOT NULL CHECK (value >= 0),
  min_subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal_cents >= 0),
  max_uses INTEGER NOT NULL DEFAULT 0 CHECK (max_uses >= 0),
  uses INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  starts_at TEXT,
  ends_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  auto_apply INTEGER NOT NULL DEFAULT 0 CHECK (auto_apply IN (0, 1)),
  days_of_week TEXT NOT NULL DEFAULT '',
  start_time TEXT,
  end_time TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS promotions_active_idx ON promotions(active, code);

CREATE TABLE IF NOT EXISTS gift_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  initial_cents INTEGER NOT NULL CHECK (initial_cents >= 0),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  expires_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gift_cards_active_idx ON gift_cards(active, code);

CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 50),
  reservation_date TEXT NOT NULL,
  reservation_time TEXT NOT NULL,
  table_id INTEGER REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'seated', 'cancelled', 'no_show')),
  notes TEXT NOT NULL DEFAULT '',
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reservations_date_idx ON reservations(reservation_date, reservation_time);

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  party_size INTEGER NOT NULL CHECK (party_size BETWEEN 1 AND 50),
  quoted_minutes INTEGER NOT NULL DEFAULT 0 CHECK (quoted_minutes >= 0),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'seated', 'cancelled')),
  notes TEXT NOT NULL DEFAULT '',
  created_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  seated_at TEXT
);
CREATE INDEX IF NOT EXISTS waitlist_status_idx ON waitlist_entries(status, created_at);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL,
  method_name TEXT NOT NULL DEFAULT '',
  method_kind TEXT NOT NULL DEFAULT 'other',
  split_id INTEGER REFERENCES order_splits(id) ON DELETE SET NULL,
  check_id INTEGER REFERENCES order_checks(id) ON DELETE SET NULL,
  gift_card_code TEXT,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  cash_received_cents INTEGER CHECK (cash_received_cents IS NULL OR cash_received_cents >= 0),
  change_cents INTEGER CHECK (change_cents IS NULL OR change_cents >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);
CREATE INDEX IF NOT EXISTS payments_shift_idx ON payments(shift_id);

CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  authorized_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  cash_cents INTEGER NOT NULL DEFAULT 0 CHECK (cash_cents >= 0),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS refunds_order_idx ON refunds(order_id);
CREATE INDEX IF NOT EXISTS refunds_shift_idx ON refunds(shift_id);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('cash', 'card', 'transfer', 'other')),
  icon TEXT NOT NULL DEFAULT 'wallet',
  allows_photo INTEGER NOT NULL DEFAULT 0 CHECK (allows_photo IN (0, 1)),
  requires_photo INTEGER NOT NULL DEFAULT 0 CHECK (requires_photo IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_methods_active_idx ON payment_methods(active, sort_order, name);

CREATE TABLE IF NOT EXISTS payment_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  filename TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  uploaded_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_photos_payment_idx ON payment_photos(payment_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS modifier_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  selection_type TEXT NOT NULL CHECK (selection_type IN ('single', 'multiple')),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  min_select INTEGER NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select INTEGER NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (min_select <= max_select)
);

CREATE TABLE IF NOT EXISTS modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  price_delta_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_delta_cents >= 0 AND price_delta_cents <= 100000),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (group_id, name)
);
CREATE INDEX IF NOT EXISTS modifiers_group_idx ON modifiers(group_id, sort_order);

CREATE TABLE IF NOT EXISTS product_modifier_groups (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, group_id)
);

CREATE TABLE IF NOT EXISTS order_item_modifiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_id INTEGER REFERENCES modifiers(id) ON DELETE SET NULL,
  group_name TEXT NOT NULL,
  modifier_name TEXT NOT NULL,
  price_delta_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_delta_cents >= 0)
);
CREATE INDEX IF NOT EXISTS order_item_modifiers_item_idx ON order_item_modifiers(order_item_id);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  sku TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'g' CHECK (unit IN ('g', 'ml', 'pz')),
  current_milli INTEGER NOT NULL DEFAULT 0,
  min_milli INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('receipt', 'adjustment', 'consumption', 'waste')),
  quantity_milli INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_movements_item_idx ON inventory_movements(item_id, created_at);

CREATE TABLE IF NOT EXISTS combo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combo_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
  UNIQUE (combo_product_id, component_product_id)
);
CREATE INDEX IF NOT EXISTS combo_items_combo_idx ON combo_items(combo_product_id);

CREATE TABLE IF NOT EXISTS product_ingredients (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
  PRIMARY KEY (product_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS integrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  base_url TEXT NOT NULL DEFAULT '',
  auth_type TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'api_key')),
  api_key TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
`;

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
}

function ensureColumn(db, table, name, definition) {
  const columns = tableColumns(db, table);
  if (!columns.has(name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
}

export function openDatabase(filename) {
  if (filename !== ':memory:') {
    mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (filename !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  return db;
}

function tableSql(db, table) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql ?? '';
}

function rebuildLegacyPaymentTables(db) {
  const orderSql = tableSql(db, 'orders');
  const paymentSql = tableSql(db, 'payments');
  const legacyOrder = /CHECK\s*\(\s*payment_method\s+IN/i.test(orderSql);
  const legacyPayment = /CHECK\s*\(\s*payment_method\s+IN/i.test(paymentSql);
  if (!legacyOrder && !legacyPayment) return;

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(`
      CREATE TABLE orders_rebuild (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN ('mesa', 'llevar')),
        table_id INTEGER REFERENCES restaurant_tables(id),
        status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'pagada', 'anulada')),
        customer_name TEXT NOT NULL DEFAULT '',
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        promotion_id INTEGER REFERENCES promotions(id) ON DELETE SET NULL,
        promotion_code TEXT NOT NULL DEFAULT '',
        loyalty_points_earned INTEGER NOT NULL DEFAULT 0,
        loyalty_points_redeemed INTEGER NOT NULL DEFAULT 0,
        loyalty_awarded INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
        discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'percent', 'fixed')),
        discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
        discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
        discount_reason TEXT NOT NULL DEFAULT '',
        tax_rate_bps INTEGER NOT NULL DEFAULT 1600 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
        tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
        tip_type TEXT NOT NULL DEFAULT 'none' CHECK (tip_type IN ('none', 'percent', 'fixed')),
        tip_value INTEGER NOT NULL DEFAULT 0 CHECK (tip_value >= 0),
        tip_cents INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
        total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
        payment_method TEXT,
        payment_method_name TEXT NOT NULL DEFAULT '',
        cash_received_cents INTEGER CHECK (cash_received_cents IS NULL OR cash_received_cents >= 0),
        change_cents INTEGER CHECK (change_cents IS NULL OR change_cents >= 0),
        business_date TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        paid_at TEXT,
        cancelled_at TEXT,
        refunded_at TEXT,
        refund_cents INTEGER NOT NULL DEFAULT 0,
        refund_reason TEXT NOT NULL DEFAULT '',
        delivery INTEGER NOT NULL DEFAULT 0 CHECK (delivery IN (0, 1)),
        customer_phone TEXT NOT NULL DEFAULT '',
        delivery_address TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'pos',
        amount_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_paid_cents >= 0),
        opened_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        closed_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
        kitchen_sent_at TEXT,
        scheduled_for TEXT,
        delivery_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (delivery_fee_cents >= 0),
  public_receipt_token TEXT UNIQUE,
  client_operation_id TEXT UNIQUE,
        CHECK (
          (type = 'mesa' AND table_id IS NOT NULL) OR
          (type = 'llevar' AND table_id IS NULL)
        )
      );

      INSERT INTO orders_rebuild (
        id, order_number, type, table_id, status, customer_name, customer_id, promotion_id, promotion_code, loyalty_points_earned, loyalty_points_redeemed, loyalty_awarded, notes,
        subtotal_cents, discount_type, discount_value, discount_cents, discount_reason,
        tax_rate_bps, tax_cents, tip_type, tip_value, tip_cents, total_cents,
        payment_method, payment_method_name, cash_received_cents, change_cents,
        business_date, created_at, updated_at, paid_at, cancelled_at,
        refunded_at, refund_cents, refund_reason,
        delivery, customer_phone, delivery_address, source, amount_paid_cents,
        opened_by_staff_id, closed_by_staff_id, shift_id, kitchen_sent_at,
        scheduled_for, delivery_fee_cents, public_receipt_token, client_operation_id
      )
      SELECT
        id, order_number, type, table_id, status, customer_name, customer_id, promotion_id, promotion_code, loyalty_points_earned, loyalty_points_redeemed, loyalty_awarded, notes,
        subtotal_cents, discount_type, discount_value, discount_cents, discount_reason,
        tax_rate_bps, tax_cents, tip_type, tip_value, tip_cents, total_cents,
        payment_method,
        COALESCE(payment_method_name, CASE payment_method WHEN 'efectivo' THEN 'Efectivo' WHEN 'tarjeta' THEN 'Tarjeta' ELSE '' END),
        cash_received_cents, change_cents,
        business_date, created_at, updated_at, paid_at, cancelled_at,
        refunded_at, refund_cents, refund_reason,
        delivery, customer_phone, delivery_address, source, amount_paid_cents,
        opened_by_staff_id, closed_by_staff_id, shift_id, kitchen_sent_at,
        scheduled_for, delivery_fee_cents, public_receipt_token, client_operation_id
      FROM orders;
    `);

    db.exec(`
      CREATE TABLE payments_rebuild (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
        staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
        payment_method TEXT NOT NULL,
        method_name TEXT NOT NULL DEFAULT '',
        method_kind TEXT NOT NULL DEFAULT 'other',
        split_id INTEGER REFERENCES order_splits(id) ON DELETE SET NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        cash_received_cents INTEGER CHECK (cash_received_cents IS NULL OR cash_received_cents >= 0),
        change_cents INTEGER CHECK (change_cents IS NULL OR change_cents >= 0),
        created_at TEXT NOT NULL
      );
      INSERT INTO payments_rebuild (
        id, order_id, shift_id, staff_id, payment_method, method_name, method_kind, split_id,
        amount_cents, cash_received_cents, change_cents, created_at
      )
      SELECT
        id, order_id, shift_id, staff_id, payment_method,
        CASE payment_method WHEN 'efectivo' THEN 'Efectivo' WHEN 'tarjeta' THEN 'Tarjeta' ELSE 'Otro' END,
        CASE payment_method WHEN 'efectivo' THEN 'cash' WHEN 'tarjeta' THEN 'card' ELSE 'other' END,
        split_id, amount_cents, cash_received_cents, change_cents, created_at
      FROM payments;
    `);

    db.exec('DROP TABLE payments;');
    db.exec('DROP TABLE orders;');
    db.exec('ALTER TABLE orders_rebuild RENAME TO orders;');
    db.exec('ALTER TABLE payments_rebuild RENAME TO payments;');
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS one_open_order_per_table ON orders(table_id) WHERE status = 'abierta' AND table_id IS NOT NULL;");
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function rebuildStaffRoleTable(db) {
  const sql = tableSql(db, 'staff');
  if (!sql || sql.includes("'owner'")) return;
  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN IMMEDIATE;');
  try {
    db.exec(`
      CREATE TABLE staff_rebuild (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'manager', 'cashier', 'server', 'kitchen')),
        pin_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO staff_rebuild (id, name, role, pin_hash, active, created_at, updated_at)
      SELECT id, name, role, pin_hash, active, created_at, updated_at FROM staff;
      DROP TABLE staff;
      ALTER TABLE staff_rebuild RENAME TO staff;
      CREATE INDEX IF NOT EXISTS staff_active_idx ON staff(active, name);
    `);
    db.exec('COMMIT;');
  } catch (error) {
    try { db.exec('ROLLBACK;'); } catch {}
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

export function migrate(db) {
  db.exec(BASE_SCHEMA);
  db.exec(OPERATIONS_SCHEMA);

  ensureColumn(db, 'restaurant_tables', 'area_id', 'INTEGER REFERENCES areas(id)');
  ensureColumn(db, 'restaurant_tables', 'position', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'restaurant_tables', 'qr_token', 'TEXT');
  ensureColumn(db, 'restaurant_tables', 'active', 'INTEGER NOT NULL DEFAULT 1');

  ensureColumn(db, 'orders', 'delivery', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'orders', 'customer_phone', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'orders', 'customer_id', 'INTEGER REFERENCES customers(id)');
  ensureColumn(db, 'orders', 'promotion_id', 'INTEGER REFERENCES promotions(id)');
  ensureColumn(db, 'orders', 'promotion_code', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'orders', 'precheck_tip_type', 'TEXT');
  ensureColumn(db, 'orders', 'precheck_tip_value', 'INTEGER');
  ensureColumn(db, 'orders', 'precheck_tip_cents', 'INTEGER');
  ensureColumn(db, 'orders', 'loyalty_points_earned', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'orders', 'loyalty_points_redeemed', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'orders', 'loyalty_awarded', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'orders', 'delivery_address', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'orders', 'source', "TEXT NOT NULL DEFAULT 'pos'");
  ensureColumn(db, 'orders', 'amount_paid_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'orders', 'opened_by_staff_id', 'INTEGER REFERENCES staff(id)');
  ensureColumn(db, 'orders', 'closed_by_staff_id', 'INTEGER REFERENCES staff(id)');
  ensureColumn(db, 'orders', 'shift_id', 'INTEGER REFERENCES shifts(id)');
  ensureColumn(db, 'orders', 'kitchen_sent_at', 'TEXT');
  ensureColumn(db, 'orders', 'scheduled_for', 'TEXT');
  ensureColumn(db, 'orders', 'delivery_fee_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'orders', 'payment_method_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'orders', 'public_receipt_token', 'TEXT');
  ensureColumn(db, 'orders', 'client_operation_id', 'TEXT');
  ensureColumn(db, 'orders', 'discount_reason', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'orders', 'refunded_at', 'TEXT');
  ensureColumn(db, 'orders', 'refund_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'orders', 'refund_reason', "TEXT NOT NULL DEFAULT ''");

  ensureColumn(db, 'products', 'image_path', 'TEXT');
  ensureColumn(db, 'products', 'station_id', 'INTEGER REFERENCES kitchen_stations(id)');
  ensureColumn(db, 'products', 'prep_seconds', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'products', 'is_combo', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'payments', 'method_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'payments', 'method_kind', "TEXT NOT NULL DEFAULT 'other'");
  ensureColumn(db, 'payments', 'split_id', 'INTEGER REFERENCES order_splits(id)');
  ensureColumn(db, 'payments', 'gift_card_code', 'TEXT');
  ensureColumn(db, 'payments', 'points_redeemed', 'INTEGER NOT NULL DEFAULT 0');

  migrateLegacySplits(db);
  ensureColumn(db, 'promotions', 'auto_apply', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'promotions', 'days_of_week', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'promotions', 'start_time', 'TEXT');
  ensureColumn(db, 'promotions', 'end_time', 'TEXT');

  ensureColumn(db, 'order_items', 'status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, 'order_items', 'course', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'order_items', 'sent_at', 'TEXT');
  ensureColumn(db, 'order_items', 'ready_at', 'TEXT');
  ensureColumn(db, 'order_items', 'served_at', 'TEXT');
  ensureColumn(db, 'order_items', 'modifiers_total_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'order_items', 'sent_quantity', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'order_items', 'split_id', 'INTEGER REFERENCES order_splits(id)');
  ensureColumn(db, 'order_items', 'check_id', 'INTEGER REFERENCES order_checks(id)');
  ensureColumn(db, 'payments', 'check_id', 'INTEGER REFERENCES order_checks(id)');
  ensureColumn(db, 'order_items', 'station_id', 'INTEGER REFERENCES kitchen_stations(id)');
  ensureColumn(db, 'order_items', 'prep_seconds', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'inventory_movements', 'order_id', 'INTEGER REFERENCES orders(id)');
  db.exec("UPDATE order_items SET sent_quantity = quantity WHERE status <> 'pending' AND sent_quantity = 0");

  rebuildStaffRoleTable(db);
  rebuildLegacyPaymentTables(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS orders_table_open_idx ON orders(table_id, status);
    CREATE INDEX IF NOT EXISTS orders_source_idx ON orders(source, status);
    CREATE UNIQUE INDEX IF NOT EXISTS orders_receipt_token_idx ON orders(public_receipt_token) WHERE public_receipt_token IS NOT NULL;
    CREATE INDEX IF NOT EXISTS order_items_status_idx ON order_items(status, order_id);
    CREATE INDEX IF NOT EXISTS restaurant_tables_area_idx ON restaurant_tables(area_id, position);
  `);

  // Compatibilidad con ventas anteriores a la tabla de pagos.
  db.exec(`
    INSERT INTO payments
      (order_id, shift_id, staff_id, payment_method, method_name, method_kind,
       amount_cents, cash_received_cents, change_cents, created_at)
    SELECT o.id, NULL, NULL, COALESCE(o.payment_method, 'otro'),
           COALESCE(NULLIF(o.payment_method_name, ''), CASE o.payment_method WHEN 'efectivo' THEN 'Efectivo' WHEN 'tarjeta' THEN 'Tarjeta' ELSE 'Otro' END),
           CASE o.payment_method WHEN 'efectivo' THEN 'cash' WHEN 'tarjeta' THEN 'card' ELSE 'other' END,
           o.total_cents,
           o.cash_received_cents, COALESCE(o.change_cents, 0), COALESCE(o.paid_at, o.created_at)
    FROM orders o
    WHERE o.status = 'pagada'
      AND o.total_cents > 0
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id);
    UPDATE orders
    SET amount_paid_cents = total_cents
    WHERE status = 'pagada' AND amount_paid_cents = 0;
  `);

  db.exec('PRAGMA user_version = 3;');
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // La transacción pudo haberse cerrado ya; conservamos el error original.
    }
    throw error;
  }
}

const SEED_CATEGORIES = [
  {
    name: 'Entradas',
    description: 'Para compartir o empezar',
    sortOrder: 10,
    products: [
      ['Guacamole con totopos', 'Aguacate, cilantro, cebolla y chile serrano.', 8900, 10],
      ['Queso fundido', 'Queso Oaxaca gratinado con chorizo de la casa.', 10500, 20],
      ['Ensalada de la casa', 'Lechugas de temporada, jitomate, pepino y aderezo cítrico.', 9500, 30],
      ['Sopa de tortilla', 'Caldo de jitomate, tortilla crujiente y crema.', 7800, 40],
    ],
  },
  {
    name: 'Platos fuertes',
    description: 'Cocina de la casa',
    sortOrder: 20,
    products: [
      ['Tacos al pastor', 'Tres tacos con piña, cebolla, cilantro y salsa verde.', 16500, 10],
      ['Enchiladas verdes', 'Tres enchiladas de pollo con salsa de tomatillo.', 17500, 20],
      ['Hamburguesa de res', 'Res 180 g, queso cheddar, papas y aderezo de la casa.', 19500, 30],
      ['Salmón a la parrilla', 'Salmón, vegetales asados y mantequilla de limón.', 24500, 40],
      ['Pasta Alfredo', 'Fettuccine, crema, parmesano y champiñones.', 18500, 50],
    ],
  },
  {
    name: 'Bebidas',
    description: 'Fríos y calientes',
    sortOrder: 30,
    products: [
      ['Agua mineral', 'Botella 600 ml.', 3500, 10],
      ['Refresco', 'Lata 355 ml. Pregunta por sabores.', 4000, 20],
      ['Limonada de la casa', 'Limón, menta y agua mineral.', 4500, 30],
      ['Cerveza artesanal', 'Cerveza local de temporada, 355 ml.', 6500, 40],
      ['Café de olla', 'Café de grano con canela y piloncillo.', 3000, 50],
    ],
  },
  {
    name: 'Postres',
    description: 'El final feliz',
    sortOrder: 40,
    products: [
      ['Flan napolitano', 'Flan de caramelo con crema batida.', 6000, 10],
      ['Pastel de chocolate', 'Rebanada de chocolate 70% con ganache.', 7000, 20],
      ['Churros', 'Cuatro churros con cajeta y canela.', 5500, 30],
    ],
  },
];

const SEED_TABLES = [
  ['Mesa 1', 4],
  ['Mesa 2', 4],
  ['Mesa 3', 2],
  ['Mesa 4', 2],
  ['Mesa 5', 4],
  ['Mesa 6', 4],
  ['Mesa 7', 6],
  ['Mesa 8', 6],
];

const SETTINGS_DEFAULTS = {
  restaurant_name: 'Casa Roble',
  restaurant_tagline: 'Cocina de la casa',
  restaurant_address: '',
  restaurant_phone: '',
  online_ordering_enabled: 'false',
  online_pickup_enabled: 'true',
  online_delivery_enabled: 'true',
  delivery_fee_cents: '0',
  printer_enabled: 'false',
  printer_connection: 'network',
  printer_paper_width_mm: '80',
  kitchen_printer_host: '',
  kitchen_printer_port: '9100',
  receipt_printer_host: '',
  receipt_printer_port: '9100',
  printer_allowed_hosts: '',
  auto_print_kitchen: 'false',
  require_shift: 'true',
  server_can_charge: 'true',
  currency: 'CRC',
  loyalty_points_per_1000_cents: '1',
  loyalty_point_value_cents: '10',
  ...Object.fromEntries(FEATURE_KEYS.map((key) => [featureSettingKey(key), FEATURES[key].defaultEnabled ? 'true' : 'false'])),
};

export function seedDatabase(db, { now = new Date().toISOString() } = {}) {
  const categoryCount = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count;
  if (categoryCount > 0) return { seeded: false };

  transaction(db, () => {
    const insertCategory = db.prepare(`
      INSERT INTO categories (name, description, sort_order, active, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?)
    `);
    const insertProduct = db.prepare(`
      INSERT INTO products
        (category_id, name, description, price_cents, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    `);
    for (const category of SEED_CATEGORIES) {
      const result = insertCategory.run(
        category.name,
        category.description,
        category.sortOrder,
        now,
        now,
      );
      const categoryId = Number(result.lastInsertRowid);
      for (const [name, description, priceCents, sortOrder] of category.products) {
        insertProduct.run(categoryId, name, description, priceCents, sortOrder, now, now);
      }
    }

    const insertTable = db.prepare(`
      INSERT INTO restaurant_tables (name, capacity, status, created_at)
      VALUES (?, ?, 'libre', ?)
    `);
    for (const [name, capacity] of SEED_TABLES) {
      insertTable.run(name, capacity, now);
    }
  });

  return { seeded: true };
}

export function seedOperationalData(db, { now = new Date().toISOString() } = {}) {
  transaction(db, () => {
    const insertSetting = db.prepare(
      'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    );
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
      insertSetting.run(key, value, now);
    }

    const stationCount = db.prepare('SELECT COUNT(*) AS count FROM kitchen_stations').get().count;
    if (stationCount === 0) {
      const insertStation = db.prepare(`
        INSERT INTO kitchen_stations (name, color, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?)
      `);
      for (const [name, color, sortOrder] of [['Cocina', '#c45d3a', 10], ['Barra', '#3f7d6a', 20], ['Postres', '#9a6b3f', 30]]) {
        insertStation.run(name, color, sortOrder, now, now);
      }
    }

    const paymentMethodCount = db
      .prepare('SELECT COUNT(*) AS count FROM payment_methods')
      .get().count;
    if (paymentMethodCount === 0) {
      const insertMethod = db.prepare(`
        INSERT INTO payment_methods
          (code, name, kind, icon, allows_photo, active, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
      `);
      for (const method of [
        ['efectivo', 'Efectivo', 'cash', 'cash', 0, 10],
        ['tarjeta', 'Tarjeta débito/crédito', 'card', 'card', 0, 20],
        ['sinpe', 'SINPE Móvil', 'transfer', 'phone', 1, 30],
        ['transferencia', 'Transferencia bancaria', 'transfer', 'wallet', 1, 40],
        ['otro', 'Otro', 'other', 'receipt', 0, 50],
        ['gift_card', 'Gift card', 'other', 'wallet', 0, 60],
        ['puntos', 'Puntos', 'other', 'star', 0, 70],
      ]) {
        insertMethod.run(...method, now, now);
      }
    }

    let areaCount = db.prepare('SELECT COUNT(*) AS count FROM areas').get().count;
    if (areaCount === 0) {
      db.prepare(
        'INSERT INTO areas (name, sort_order, active, created_at) VALUES (?, ?, 1, ?)',
      ).run('Salón principal', 10, now);
      db.prepare(
        'INSERT INTO areas (name, sort_order, active, created_at) VALUES (?, ?, 1, ?)',
      ).run('Terraza', 20, now);
      areaCount = 2;
    }
    const mainArea = db.prepare('SELECT id FROM areas ORDER BY sort_order, id LIMIT 1').get();
    const terraceArea = db
      .prepare('SELECT id FROM areas ORDER BY sort_order DESC, id DESC LIMIT 1')
      .get();
    const unassigned = db
      .prepare('SELECT id, name FROM restaurant_tables WHERE area_id IS NULL ORDER BY id')
      .all();
    const updateTable = db.prepare(
      'UPDATE restaurant_tables SET area_id = ?, position = ? WHERE id = ?',
    );
    for (const table of unassigned) {
      const numeric = Number(String(table.name).replace(/\D+/g, '')) || Number(table.id);
      const areaId = areaCount > 1 && numeric >= 7 ? Number(terraceArea.id) : Number(mainArea.id);
      updateTable.run(areaId, numeric, Number(table.id));
    }

    const modifierGroupCount = db
      .prepare('SELECT COUNT(*) AS count FROM modifier_groups')
      .get().count;
    if (modifierGroupCount === 0) {
      const insertGroup = db.prepare(`
        INSERT INTO modifier_groups
          (name, selection_type, required, min_select, max_select, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `);
      const insertModifier = db.prepare(`
        INSERT INTO modifiers (group_id, name, price_delta_cents, sort_order, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `);
      const assign = db.prepare(
        'INSERT OR IGNORE INTO product_modifier_groups (product_id, group_id, sort_order) VALUES (?, ?, ?)',
      );

      const extrasResult = insertGroup.run('Extras', 'multiple', 0, 0, 4, 10, now, now);
      const extrasId = Number(extrasResult.lastInsertRowid);
      const extras = [
        ['Extra queso', 1500, 10],
        ['Extra aguacate', 2000, 20],
        ['Sin cebolla', 0, 30],
        ['Sin picante', 0, 40],
        ['Extra salsa', 500, 50],
      ];
      for (const [name, price, order] of extras) {
        insertModifier.run(extrasId, name, price, order, now, now);
      }

      const termResult = insertGroup.run('Término de la carne', 'single', 1, 1, 1, 20, now, now);
      const termId = Number(termResult.lastInsertRowid);
      for (const [name, order] of [
        ['Término medio', 10],
        ['Tres cuartos', 20],
        ['Bien cocido', 30],
      ]) {
        insertModifier.run(termId, name, 0, order, now, now);
      }

      const foodProducts = db
        .prepare(`
          SELECT p.id FROM products p
          JOIN categories c ON c.id = p.category_id
          WHERE c.name IN ('Entradas', 'Platos fuertes')
        `)
        .all();
      for (const product of foodProducts) {
        assign.run(Number(product.id), extrasId, 10);
      }
      const cookedProducts = db
        .prepare(`
          SELECT id FROM products WHERE name IN ('Hamburguesa de res', 'Salmón a la parrilla')
        `)
        .all();
      for (const product of cookedProducts) {
        assign.run(Number(product.id), termId, 5);
      }
    }
  });
  ensureTableQrTokens(db);
}

export function repairTableStatuses(db) {
  db.exec(`
    UPDATE restaurant_tables
    SET status = 'ocupada'
    WHERE EXISTS (
      SELECT 1 FROM orders o
      WHERE o.table_id = restaurant_tables.id AND o.status = 'abierta'
    );
    UPDATE restaurant_tables
    SET status = 'libre'
    WHERE NOT EXISTS (
      SELECT 1 FROM orders o
      WHERE o.table_id = restaurant_tables.id AND o.status = 'abierta'
    );
  `);
}


export function ensureTableQrTokens(db) {
  const rows = db.prepare("SELECT id FROM restaurant_tables WHERE qr_token IS NULL OR qr_token = ''").all();
  const update = db.prepare('UPDATE restaurant_tables SET qr_token = ? WHERE id = ?');
  for (const row of rows) {
    update.run(randomBytes(16).toString('hex'), row.id);
  }
  return rows.length;
}


function migrateLegacySplits(db) {
  const legacy = db.prepare(`
    SELECT s.* FROM order_splits s
    LEFT JOIN order_checks c ON c.legacy_split_id = s.id
    WHERE c.id IS NULL
    ORDER BY s.id
  `).all();
  if (legacy.length === 0) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const insertCheck = db.prepare(`
      INSERT INTO order_checks
        (order_id, label, status, subtotal_cents, total_cents, amount_paid_cents,
         legacy_split_id, created_at, paid_at, created_by_staff_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLine = db.prepare(`
      INSERT OR IGNORE INTO order_check_lines (check_id, order_item_id, quantity_milli, created_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const split of legacy) {
      const result = insertCheck.run(
        split.order_id, split.label, split.status, split.total_cents, split.total_cents,
        split.amount_paid_cents, split.id, split.created_at, split.paid_at, split.created_by_staff_id,
      );
      const checkId = Number(result.lastInsertRowid);
      const items = db.prepare('SELECT id, quantity FROM order_items WHERE split_id = ? ORDER BY id').all(split.id);
      for (const item of items) {
        insertLine.run(checkId, item.id, Number(item.quantity) * 1000, split.created_at);
        db.prepare('UPDATE order_items SET check_id = ? WHERE id = ?').run(checkId, item.id);
      }
      db.prepare('UPDATE payments SET check_id = ? WHERE split_id = ?').run(checkId, split.id);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
