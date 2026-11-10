import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

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

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0 AND price_cents <= 1000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('mesa', 'llevar')),
  table_id INTEGER REFERENCES restaurant_tables(id),
  status TEXT NOT NULL DEFAULT 'abierta' CHECK (status IN ('abierta', 'pagada', 'anulada')),
  customer_name TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  discount_type TEXT NOT NULL DEFAULT 'none' CHECK (discount_type IN ('none', 'percent', 'fixed')),
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_rate_bps INTEGER NOT NULL DEFAULT 1600 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  tip_type TEXT NOT NULL DEFAULT 'none' CHECK (tip_type IN ('none', 'percent', 'fixed')),
  tip_value INTEGER NOT NULL DEFAULT 0 CHECK (tip_value >= 0),
  tip_cents INTEGER NOT NULL DEFAULT 0 CHECK (tip_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  payment_method TEXT CHECK (payment_method IN ('efectivo', 'tarjeta', 'otro') OR payment_method IS NULL),
  cash_received_cents INTEGER CHECK (cash_received_cents IS NULL OR cash_received_cents >= 0),
  change_cents INTEGER CHECK (change_cents IS NULL OR change_cents >= 0),
  business_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT,
  cancelled_at TEXT,
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
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS order_items_client_key_unique
  ON order_items(order_id, client_key);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items(order_id, sort_order);
`;

const OPERATIONS_SCHEMA = `
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cashier', 'server', 'kitchen')),
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

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shift_id INTEGER REFERENCES shifts(id) ON DELETE SET NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('efectivo', 'tarjeta', 'otro')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  cash_received_cents INTEGER CHECK (cash_received_cents IS NULL OR cash_received_cents >= 0),
  change_cents INTEGER CHECK (change_cents IS NULL OR change_cents >= 0),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_order_idx ON payments(order_id);
CREATE INDEX IF NOT EXISTS payments_shift_idx ON payments(shift_id);

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

export function migrate(db) {
  db.exec(BASE_SCHEMA);
  db.exec(OPERATIONS_SCHEMA);

  ensureColumn(db, 'restaurant_tables', 'area_id', 'INTEGER REFERENCES areas(id)');
  ensureColumn(db, 'restaurant_tables', 'position', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'restaurant_tables', 'active', 'INTEGER NOT NULL DEFAULT 1');

  ensureColumn(db, 'orders', 'delivery', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'orders', 'customer_phone', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'orders', 'delivery_address', "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, 'orders', 'source', "TEXT NOT NULL DEFAULT 'pos'");
  ensureColumn(db, 'orders', 'amount_paid_cents', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'orders', 'opened_by_staff_id', 'INTEGER REFERENCES staff(id)');
  ensureColumn(db, 'orders', 'closed_by_staff_id', 'INTEGER REFERENCES staff(id)');
  ensureColumn(db, 'orders', 'shift_id', 'INTEGER REFERENCES shifts(id)');
  ensureColumn(db, 'orders', 'kitchen_sent_at', 'TEXT');
  ensureColumn(db, 'orders', 'scheduled_for', 'TEXT');
  ensureColumn(db, 'orders', 'delivery_fee_cents', 'INTEGER NOT NULL DEFAULT 0');

  ensureColumn(db, 'order_items', 'status', "TEXT NOT NULL DEFAULT 'pending'");
  ensureColumn(db, 'order_items', 'course', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'order_items', 'sent_at', 'TEXT');
  ensureColumn(db, 'order_items', 'ready_at', 'TEXT');
  ensureColumn(db, 'order_items', 'served_at', 'TEXT');
  ensureColumn(db, 'order_items', 'modifiers_total_cents', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE INDEX IF NOT EXISTS orders_table_open_idx ON orders(table_id, status);
    CREATE INDEX IF NOT EXISTS orders_source_idx ON orders(source, status);
    CREATE INDEX IF NOT EXISTS order_items_status_idx ON order_items(status, order_id);
    CREATE INDEX IF NOT EXISTS restaurant_tables_area_idx ON restaurant_tables(area_id, position);
  `);

  // Compatibilidad con ventas anteriores a la tabla de pagos.
  db.exec(`
    INSERT INTO payments
      (order_id, shift_id, staff_id, payment_method, amount_cents, cash_received_cents,
       change_cents, created_at)
    SELECT o.id, NULL, NULL, COALESCE(o.payment_method, 'otro'), o.total_cents,
           o.cash_received_cents, COALESCE(o.change_cents, 0), COALESCE(o.paid_at, o.created_at)
    FROM orders o
    WHERE o.status = 'pagada'
      AND o.total_cents > 0
      AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id);
    UPDATE orders
    SET amount_paid_cents = total_cents
    WHERE status = 'pagada' AND amount_paid_cents = 0;
  `);

  db.exec('PRAGMA user_version = 2;');
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
  online_ordering_enabled: 'false',
  online_pickup_enabled: 'true',
  online_delivery_enabled: 'true',
  delivery_fee_cents: '0',
  printer_enabled: 'false',
  kitchen_printer_host: '',
  kitchen_printer_port: '9100',
  receipt_printer_host: '',
  receipt_printer_port: '9100',
  auto_print_kitchen: 'false',
  require_shift: 'true',
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
