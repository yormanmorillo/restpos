import { notFound, conflict, validationError } from './errors.js';
import { serializeCategory, serializeProduct } from './serializers.js';
import { getProductModifierGroups } from './modifiers.js';

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
      SELECT p.*, c.name AS category_name, ks.name AS station_name
      FROM products p JOIN categories c ON c.id = p.category_id
      LEFT JOIN kitchen_stations ks ON ks.id = p.station_id
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
      params.push(['active', 'isCombo'].includes(key) ? (input[key] ? 1 : 0) : input[key]);
    }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  db.prepare(`UPDATE categories SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return listAdminCategories(db).find((category) => category.id === Number(id));
}

export function listAdminProducts(db) {
  const rows = db
    .prepare(`
      SELECT p.*, c.name AS category_name, ks.name AS station_name
      FROM products p JOIN categories c ON c.id = p.category_id
      LEFT JOIN kitchen_stations ks ON ks.id = p.station_id
      ORDER BY c.sort_order, p.sort_order, p.name
    `)
    .all();
  const assignments = getProductModifierGroups(db, rows.map((row) => Number(row.id)));
  const comboRows = db.prepare(`
    SELECT ci.combo_product_id, ci.component_product_id, ci.quantity, p.name
    FROM combo_items ci JOIN products p ON p.id = ci.component_product_id
  `).all();
  const comboMap = new Map();
  for (const row of comboRows) {
    if (!comboMap.has(Number(row.combo_product_id))) comboMap.set(Number(row.combo_product_id), []);
    comboMap.get(Number(row.combo_product_id)).push({ productId: Number(row.component_product_id), name: row.name, quantity: Number(row.quantity) });
  }
  return rows.map((row) => ({
    ...serializeProduct(row),
    modifierGroupIds: (assignments.get(Number(row.id)) ?? []).map((group) => group.id),
    comboItems: comboMap.get(Number(row.id)) ?? [],
  }));
}

export function createProduct(db, input) {
  loadCategory(db, input.categoryId);
  ensureProductNameFree(db, input.categoryId, input.name);
  const timestamp = nowIso();
  const result = db
    .prepare(`
      INSERT INTO products
        (category_id, name, description, price_cents, station_id, prep_seconds, is_combo, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.categoryId,
      input.name,
      input.description ?? '',
      input.priceCents,
      input.stationId ?? null,
      input.prepSeconds ?? 0,
      input.isCombo ? 1 : 0,
      input.active === false ? 0 : 1,
      input.sortOrder ?? 0,
      timestamp,
      timestamp,
    );
  const productId = Number(result.lastInsertRowid);
  saveComboItems(db, productId, input);
  return { ...serializeProduct(loadProduct(db, productId)), comboItems: listComboItems(db, productId) };
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
    ['stationId', 'station_id'],
    ['prepSeconds', 'prep_seconds'],
    ['isCombo', 'is_combo'],
    ['sortOrder', 'sort_order'],
    ['active', 'active'],
  ];
  for (const [key, column] of mapping) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(['active', 'isCombo'].includes(key) ? (input[key] ? 1 : 0) : input[key]);
    }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(nowIso(), id);
  db.prepare(`UPDATE products SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  if (input.isCombo !== undefined || input.comboItems !== undefined) saveComboItems(db, id, input);
  return { ...serializeProduct(loadProduct(db, id)), comboItems: listComboItems(db, id) };
}


function listComboItems(db, productId) {
  return db.prepare(`SELECT ci.component_product_id, ci.quantity, p.name FROM combo_items ci JOIN products p ON p.id = ci.component_product_id WHERE ci.combo_product_id = ? ORDER BY p.name`).all(productId).map((row) => ({ productId: Number(row.component_product_id), name: row.name, quantity: Number(row.quantity) }));
}

function saveComboItems(db, productId, input) {
  const combo = input.isCombo === true || (input.isCombo === undefined && db.prepare('SELECT is_combo FROM products WHERE id = ?').get(productId)?.is_combo === 1);
  db.prepare('DELETE FROM combo_items WHERE combo_product_id = ?').run(productId);
  if (!combo || !Array.isArray(input.comboItems) || input.comboItems.length === 0) return;
  for (const item of input.comboItems) {
    if (Number(item.productId) === Number(productId)) throw validationError('Un combo no puede incluirse a sí mismo.');
    const component = db.prepare('SELECT id, is_combo FROM products WHERE id = ?').get(item.productId);
    if (!component) throw validationError('Uno de los componentes del combo no existe.');
    if (component.is_combo) throw validationError('Un combo no puede incluir otro combo.');
    db.prepare('INSERT OR REPLACE INTO combo_items (combo_product_id, component_product_id, quantity) VALUES (?, ?, ?)').run(productId, item.productId, item.quantity);
  }
}
