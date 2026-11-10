import { notFound, conflict, validationError } from './errors.js';
import { serializeCategory, serializeProduct } from './serializers.js';

function nowIso() {
  return new Date().toISOString();
}

function ensureCategoryNameFree(db, name, exceptId = null) {
  const row = db
    .prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id IS NOT ?')
    .get(name, exceptId);
  if (row) throw conflict('Ya existe una categoría con ese nombre.');
}

function ensureProductNameFree(db, categoryId, name, exceptId = null) {
  const row = db
    .prepare(`
      SELECT id FROM products
      WHERE category_id = ? AND name = ? COLLATE NOCASE AND id IS NOT ?
    `)
    .get(categoryId, name, exceptId);
  if (row) throw conflict('Ya existe un producto con ese nombre en la categoría.');
}

function loadCategory(db, id) {
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!row) throw notFound('No se encontró la categoría.');
  return row;
}

function loadProduct(db, id) {
  const row = db
    .prepare(`
      SELECT p.*, c.name AS category_name
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
    `)
    .get(id);
  if (!row) throw notFound('No se encontró el producto.');
  return row;
}

export function listAdminCategories(db) {
  return db
    .prepare(`
      SELECT c.*, COUNT(p.id) AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order, c.name
    `)
    .all()
    .map(serializeCategory);
}

export function createCategory(db, input) {
  ensureCategoryNameFree(db, input.name);
  const timestamp = nowIso();
  const result = db
    .prepare(`
      INSERT INTO categories (name, description, sort_order, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(input.name, input.description ?? '', input.sortOrder ?? 0, input.active === false ? 0 : 1, timestamp, timestamp);
  return listAdminCategories(db).find((category) => category.id === Number(result.lastInsertRowid));
}

export function updateCategory(db, id, input) {
  loadCategory(db, id);
  if (input.name !== undefined) ensureCategoryNameFree(db, input.name, id);
  const fields = [];
  const params = [];
  const mapping = [
    ['name', 'name'],
    ['description', 'description'],
    ['sortOrder', 'sort_order'],
    ['active', 'active'],
  ];
  for (const [key, column] of mapping) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(key === 'active' ? (input[key] ? 1 : 0) : input[key]);
    }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return listAdminCategories(db).find((category) => category.id === Number(id));
}

export function listAdminProducts(db) {
  return db
    .prepare(`
      SELECT p.*, c.name AS category_name
      FROM products p JOIN categories c ON c.id = p.category_id
      ORDER BY c.sort_order, p.sort_order, p.name
    `)
    .all()
    .map(serializeProduct);
}

export function createProduct(db, input) {
  loadCategory(db, input.categoryId);
  ensureProductNameFree(db, input.categoryId, input.name);
  const timestamp = nowIso();
  const result = db
    .prepare(`
      INSERT INTO products
        (category_id, name, description, price_cents, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.categoryId,
      input.name,
      input.description ?? '',
      input.priceCents,
      input.active === false ? 0 : 1,
      input.sortOrder ?? 0,
      timestamp,
      timestamp,
    );
  return serializeProduct(loadProduct(db, Number(result.lastInsertRowid)));
}

export function updateProduct(db, id, input) {
  const existing = loadProduct(db, id);
  if (input.categoryId !== undefined) {
    loadCategory(db, input.categoryId);
  }
  if (input.name !== undefined || input.categoryId !== undefined) {
    ensureProductNameFree(
      db,
      input.categoryId ?? Number(existing.category_id),
      input.name ?? existing.name,
      id,
    );
  }
  const fields = [];
  const params = [];
  const mapping = [
    ['categoryId', 'category_id'],
    ['name', 'name'],
    ['description', 'description'],
    ['priceCents', 'price_cents'],
    ['sortOrder', 'sort_order'],
    ['active', 'active'],
  ];
  for (const [key, column] of mapping) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(key === 'active' ? (input[key] ? 1 : 0) : input[key]);
    }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return serializeProduct(loadProduct(db, id));
}
