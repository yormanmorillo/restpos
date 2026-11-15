import { conflict, notFound, validationError } from './errors.js';
import { audit } from './audit.js';
import { transaction } from './db.js';

const UNITS = ['g', 'ml', 'pz'];

export function toMilli(quantity) {
  const value = Number(quantity);
  if (!Number.isFinite(value)) throw validationError('La cantidad no es válida.');
  return Math.round(value * 1000);
}

function cleanName(name) {
  if (!name || name.trim().length === 0) throw validationError('El nombre del insumo es obligatorio.');
  return name.trim();
}

export function serializeInventoryItem(row) {
  return {
    id: Number(row.id),
    name: row.name,
    sku: row.sku ?? '',
    unit: row.unit,
    currentMilli: Number(row.current_milli),
    currentQuantity: Number(row.current_milli) / 1000,
    minMilli: Number(row.min_milli),
    minQuantity: Number(row.min_milli) / 1000,
    lowStock: Number(row.current_milli) <= Number(row.min_milli),
    active: Boolean(row.active),
    updatedAt: row.updated_at,
  };
}

export function listInventoryItems(db, { activeOnly = false } = {}) {
  return db
    .prepare(`SELECT * FROM inventory_items ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY active DESC, name`)
    .all()
    .map(serializeInventoryItem);
}

export function createInventoryItem(db, input, staffId, now = new Date().toISOString()) {
  const name = cleanName(input.name);
  if (!UNITS.includes(input.unit)) throw validationError('Selecciona una unidad válida.');
  const duplicate = db.prepare('SELECT id FROM inventory_items WHERE name = ? COLLATE NOCASE').get(name);
  if (duplicate) throw conflict('Ya existe un insumo con ese nombre.');
  const result = db.prepare(`
    INSERT INTO inventory_items (name, sku, unit, current_milli, min_milli, active, created_at, updated_at)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?)
  `).run(name, input.sku ?? '', input.unit, toMilli(input.minQuantity ?? 0), input.active === false ? 0 : 1, now, now);
  const id = Number(result.lastInsertRowid);
  audit(db, staffId, 'inventory.item.create', 'inventory_item', id, { name, unit: input.unit });
  return serializeInventoryItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id));
}

export function updateInventoryItem(db, id, input, staffId, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró el insumo.');
  if (input.name !== undefined) {
    const duplicate = db.prepare('SELECT id FROM inventory_items WHERE name = ? COLLATE NOCASE AND id != ?').get(input.name.trim(), id);
    if (duplicate) throw conflict('Ya existe un insumo con ese nombre.');
  }
  if (input.unit !== undefined && !UNITS.includes(input.unit)) throw validationError('Unidad inválida.');
  const fields = [];
  const params = [];
  if (input.name !== undefined) { fields.push('name = ?'); params.push(input.name.trim()); }
  if (input.sku !== undefined) { fields.push('sku = ?'); params.push(input.sku); }
  if (input.unit !== undefined) { fields.push('unit = ?'); params.push(input.unit); }
  if (input.minQuantity !== undefined) { fields.push('min_milli = ?'); params.push(toMilli(input.minQuantity)); }
  if (input.active !== undefined) { fields.push('active = ?'); params.push(input.active ? 1 : 0); }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE inventory_items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  audit(db, staffId, 'inventory.item.update', 'inventory_item', id, input);
  return serializeInventoryItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id));
}

export function receiveInventory(db, itemId, input, staffId, now = new Date().toISOString()) {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId);
  if (!item) throw notFound('No se encontró el insumo.');
  const quantityMilli = toMilli(input.quantity);
  if (quantityMilli <= 0) throw validationError('La cantidad recibida debe ser mayor que cero.');
  transaction(db, () => {
    db.prepare('UPDATE inventory_items SET current_milli = current_milli + ?, updated_at = ? WHERE id = ?')
      .run(quantityMilli, now, itemId);
    db.prepare(`
      INSERT INTO inventory_movements (item_id, type, quantity_milli, cost_cents, reference, notes, staff_id, created_at)
      VALUES (?, 'receipt', ?, ?, ?, ?, ?, ?)
    `).run(itemId, quantityMilli, Math.max(0, Math.round(Number(input.costCents ?? 0))), input.reference ?? '', input.notes ?? '', staffId, now);
    audit(db, staffId, 'inventory.receipt', 'inventory_item', itemId, { quantity: input.quantity, costCents: input.costCents ?? 0 });
  });
  return {
    item: serializeInventoryItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId)),
    movement: serializeMovement(db.prepare('SELECT m.*, i.name AS item_name, i.unit AS item_unit FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id WHERE m.item_id = ? ORDER BY m.id DESC LIMIT 1').get(itemId)),
  };
}

export function adjustInventory(db, itemId, input, staffId, now = new Date().toISOString()) {
  const item = db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId);
  if (!item) throw notFound('No se encontró el insumo.');
  const countedMilli = toMilli(input.countedQuantity);
  if (countedMilli < 0) throw validationError('El conteo no puede ser negativo.');
  const delta = countedMilli - Number(item.current_milli);
  if (delta === 0) throw validationError('El conteo es igual al stock actual.');
  transaction(db, () => {
    db.prepare('UPDATE inventory_items SET current_milli = ?, updated_at = ? WHERE id = ?').run(countedMilli, now, itemId);
    db.prepare(`
      INSERT INTO inventory_movements (item_id, type, quantity_milli, reference, notes, staff_id, created_at)
      VALUES (?, 'adjustment', ?, 'Ajuste de conteo', ?, ?, ?)
    `).run(itemId, delta, input.notes ?? '', staffId, now);
    audit(db, staffId, 'inventory.adjustment', 'inventory_item', itemId, { countedQuantity: input.countedQuantity, deltaMilli: delta });
  });
  return serializeInventoryItem(db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId));
}

export function serializeMovement(row) {
  return {
    id: Number(row.id),
    itemId: Number(row.item_id),
    itemName: row.item_name ?? null,
    itemUnit: row.item_unit ?? null,
    type: row.type,
    quantityMilli: Number(row.quantity_milli),
    quantity: Number(row.quantity_milli) / 1000,
    costCents: Number(row.cost_cents ?? 0),
    reference: row.reference,
    notes: row.notes,
    staffName: row.staff_name ?? null,
    createdAt: row.created_at,
  };
}

export function listInventoryMovements(db, { itemId, limit = 100 } = {}) {
  const rows = itemId
    ? db.prepare(`
        SELECT m.*, i.name AS item_name, i.unit AS item_unit, st.name AS staff_name
        FROM inventory_movements m
        JOIN inventory_items i ON i.id = m.item_id
        LEFT JOIN staff st ON st.id = m.staff_id
        WHERE m.item_id = ? ORDER BY m.id DESC LIMIT ?
      `).all(itemId, limit)
    : db.prepare(`
        SELECT m.*, i.name AS item_name, i.unit AS item_unit, st.name AS staff_name
        FROM inventory_movements m
        JOIN inventory_items i ON i.id = m.item_id
        LEFT JOIN staff st ON st.id = m.staff_id
        ORDER BY m.id DESC LIMIT ?
      `).all(limit);
  return rows.map(serializeMovement);
}

export function listRecipes(db) {
  const products = db.prepare(`
    SELECT p.id, p.name, c.name AS category_name
    FROM products p JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1
    ORDER BY c.sort_order, p.sort_order, p.name
  `).all();
  const ingredients = db.prepare(`
    SELECT pi.product_id, pi.quantity_milli, ii.id AS item_id, ii.name AS item_name, ii.unit AS item_unit
    FROM product_ingredients pi
    JOIN inventory_items ii ON ii.id = pi.inventory_item_id
    ORDER BY ii.name
  `).all();
  const byProduct = new Map();
  for (const row of ingredients) {
    const id = Number(row.product_id);
    if (!byProduct.has(id)) byProduct.set(id, []);
    byProduct.get(id).push({
      inventoryItemId: Number(row.item_id),
      itemName: row.item_name,
      unit: row.item_unit,
      quantity: Number(row.quantity_milli) / 1000,
      quantityMilli: Number(row.quantity_milli),
    });
  }
  return products.map((product) => ({
    productId: Number(product.id),
    productName: product.name,
    categoryName: product.category_name,
    ingredients: byProduct.get(Number(product.id)) ?? [],
  }));
}

export function saveRecipe(db, productId, ingredients, staffId, now = new Date().toISOString()) {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) throw notFound('No se encontró el producto.');
  if (!Array.isArray(ingredients)) throw validationError('La receta no es válida.');
  const normalized = [];
  for (const ingredient of ingredients) {
    const itemId = Number(ingredient.inventoryItemId);
    const quantityMilli = toMilli(ingredient.quantity);
    if (!Number.isInteger(itemId) || itemId <= 0) throw validationError('Selecciona un insumo válido.');
    if (quantityMilli <= 0) throw validationError('Cada ingrediente debe tener una cantidad mayor que cero.');
    if (normalized.some((entry) => entry.itemId === itemId)) throw conflict('No repitas el mismo insumo en la receta.');
    const item = db.prepare('SELECT id FROM inventory_items WHERE id = ?').get(itemId);
    if (!item) throw notFound('Uno de los insumos no existe.');
    normalized.push({ itemId, quantityMilli });
  }
  transaction(db, () => {
    db.prepare('DELETE FROM product_ingredients WHERE product_id = ?').run(productId);
    const insert = db.prepare('INSERT INTO product_ingredients (product_id, inventory_item_id, quantity_milli) VALUES (?, ?, ?)');
    for (const entry of normalized) insert.run(productId, entry.itemId, entry.quantityMilli);
    db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(now, productId);
    audit(db, staffId, 'inventory.recipe.update', 'product', Number(productId), { ingredients: normalized.length });
  });
  return listRecipes(db).find((recipe) => recipe.productId === Number(productId));
}

export function consumeInventoryForOrder(db, orderId, staffId, now = new Date().toISOString()) {
  const items = db.prepare(`
    SELECT oi.product_id, SUM(oi.quantity) AS quantity
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.order_id = ? AND oi.product_id IS NOT NULL AND o.status = 'pagada'
    GROUP BY oi.product_id
  `).all(orderId);
  if (items.length === 0) return;
  const recipeStatement = db.prepare(`
    SELECT inventory_item_id, quantity_milli FROM product_ingredients WHERE product_id = ?
  `);
  const order = db.prepare('SELECT order_number FROM orders WHERE id = ?').get(orderId);
  const update = db.prepare('UPDATE inventory_items SET current_milli = current_milli - ?, updated_at = ? WHERE id = ?');
  const movement = db.prepare(`
    INSERT INTO inventory_movements (item_id, type, quantity_milli, reference, notes, order_id, staff_id, created_at)
    VALUES (?, 'consumption', ?, ?, ?, ?, ?, ?)
  `);
  for (const line of items) {
    const recipe = recipeStatement.all(line.product_id);
    for (const ingredient of recipe) {
      const consumed = Number(ingredient.quantity_milli) * Number(line.quantity);
      update.run(consumed, now, ingredient.inventory_item_id);
      movement.run(ingredient.inventory_item_id, -consumed, order?.order_number ?? `Pedido ${orderId}`, 'Consumo por venta', orderId, staffId, now);
    }
  }
}
