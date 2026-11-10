import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
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
  db.exec(SCHEMA);
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
