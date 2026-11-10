import { parseMoneyToCents } from '@restpos/shared/money';
import { transaction } from './db.js';
import { audit } from './audit.js';
import { validationError } from './errors.js';

function normalizeHeader(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function parseCsv(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g) ?? []).length > (firstLine.match(/,/g) ?? []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char === '"' && clean[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (rows.length === 0) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function truthy(value, fallback = true) {
  const normalized = normalizeHeader(value);
  if (!normalized) return fallback;
  return ['1', 'si', 'sí', 'true', 'activo', 'activa', 'yes'].includes(normalized);
}

export function importProducts(db, text, staffId, now = new Date().toISOString()) {
  const rows = parseCsv(text);
  if (rows.length === 0) throw validationError('El archivo CSV está vacío.');
  const errors = [];
  const valid = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const categoryName = String(row.categoria ?? row.category ?? '').trim();
    const name = String(row.nombre ?? row.name ?? '').trim();
    const description = String(row.descripcion ?? row.description ?? '').trim();
    const priceText = String(row.precio ?? row.price ?? '').trim();
    const sortOrder = Number(row.orden ?? row.sort_order ?? 0) || 0;
    if (!categoryName) { errors.push({ line, message: 'Falta la categoría.' }); return; }
    if (!name) { errors.push({ line, message: 'Falta el nombre del producto.' }); return; }
    if (!priceText) { errors.push({ line, message: 'Falta el precio.' }); return; }
    let priceCents;
    try {
      priceCents = parseMoneyToCents(priceText);
    } catch {
      errors.push({ line, message: `Precio inválido: ${priceText}` });
      return;
    }
    valid.push({
      line,
      categoryName,
      name,
      description,
      priceCents,
      sortOrder,
      active: truthy(row.activo ?? row.active ?? ''),
    });
  });

  let created = 0;
  let updated = 0;
  transaction(db, () => {
    const findCategory = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE');
    const insertCategory = db.prepare(`
      INSERT INTO categories (name, description, sort_order, active, created_at, updated_at)
      VALUES (?, '', 100, 1, ?, ?)
    `);
    const findProduct = db.prepare('SELECT id FROM products WHERE category_id = ? AND name = ? COLLATE NOCASE');
    const insertProduct = db.prepare(`
      INSERT INTO products
        (category_id, name, description, price_cents, active, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const updateProduct = db.prepare(`
      UPDATE products SET description = ?, price_cents = ?, active = ?, sort_order = ?, updated_at = ?
      WHERE id = ?
    `);
    for (const item of valid) {
      let category = findCategory.get(item.categoryName);
      if (!category) {
        const result = insertCategory.run(item.categoryName, now, now);
        category = { id: Number(result.lastInsertRowid) };
      }
      const existing = findProduct.get(category.id, item.name);
      if (existing) {
        updateProduct.run(item.description, item.priceCents, item.active ? 1 : 0, item.sortOrder, now, existing.id);
        updated += 1;
      } else {
        insertProduct.run(category.id, item.name, item.description, item.priceCents, item.active ? 1 : 0, item.sortOrder, now, now);
        created += 1;
      }
    }
    audit(db, staffId, 'products.import', 'product', null, { created, updated, errors: errors.length, total: rows.length });
  });
  return { total: rows.length, created, updated, errors };
}
