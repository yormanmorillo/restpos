import { randomBytes } from 'node:crypto';
import { conflict, notFound, validationError } from './errors.js';

export function listAreas(db) {
  return db
    .prepare(`
      SELECT a.*, COUNT(t.id) AS table_count
      FROM areas a
      LEFT JOIN restaurant_tables t ON t.area_id = a.id
      GROUP BY a.id
      ORDER BY a.sort_order, a.name
    `)
    .all()
    .map((row) => ({
      id: Number(row.id),
      name: row.name,
      sortOrder: Number(row.sort_order),
      active: Boolean(row.active),
      tableCount: Number(row.table_count),
      createdAt: row.created_at,
    }));
}

export function createArea(db, input, now = new Date().toISOString()) {
  const exists = db.prepare('SELECT id FROM areas WHERE name = ? COLLATE NOCASE').get(input.name);
  if (exists) throw conflict('Ya existe un área con ese nombre.');
  const result = db
    .prepare('INSERT INTO areas (name, sort_order, active, created_at) VALUES (?, ?, ?, ?)')
    .run(input.name, input.sortOrder ?? 0, input.active === false ? 0 : 1, now);
  return listAreas(db).find((area) => area.id === Number(result.lastInsertRowid));
}

export function updateArea(db, id, input) {
  const existing = db.prepare('SELECT * FROM areas WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró el área.');
  const fields = [];
  const params = [];
  if (input.name !== undefined) {
    const duplicate = db
      .prepare('SELECT id FROM areas WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(input.name, id);
    if (duplicate) throw conflict('Ya existe un área con ese nombre.');
    fields.push('name = ?');
    params.push(input.name);
  }
  if (input.sortOrder !== undefined) {
    fields.push('sort_order = ?');
    params.push(input.sortOrder);
  }
  if (input.active !== undefined) {
    fields.push('active = ?');
    params.push(input.active ? 1 : 0);
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  params.push(id);
  db.prepare(`UPDATE areas SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return listAreas(db).find((area) => area.id === Number(id));
}

function serializeTable(row) {
  return {
    id: Number(row.id),
    name: row.name,
    capacity: Number(row.capacity),
    status: row.status,
    areaId: row.area_id === null ? null : Number(row.area_id),
    areaName: row.area_name ?? null,
    position: Number(row.position ?? 0),
    qrToken: row.qr_token ?? null,
    active: Boolean(row.active),
    openOrder: row.open_order_id
      ? { id: Number(row.open_order_id), orderNumber: row.open_order_number }
      : null,
  };
}

export function listAdminTables(db) {
  return db
    .prepare(`
      SELECT t.*, a.name AS area_name, o.id AS open_order_id, o.order_number AS open_order_number
      FROM restaurant_tables t
      LEFT JOIN areas a ON a.id = t.area_id
      LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'abierta'
      ORDER BY a.sort_order, t.position, t.id
    `)
    .all()
    .map(serializeTable);
}

export function createTable(db, input, now = new Date().toISOString()) {
  const duplicate = db.prepare('SELECT id FROM restaurant_tables WHERE name = ?').get(input.name);
  if (duplicate) throw conflict('Ya existe una mesa con ese nombre.');
  if (input.areaId) {
    const area = db.prepare('SELECT id FROM areas WHERE id = ?').get(input.areaId);
    if (!area) throw notFound('No se encontró el área.');
  }
  const result = db.prepare(`
    INSERT INTO restaurant_tables (name, capacity, status, area_id, position, qr_token, active, created_at)
    VALUES (?, ?, 'libre', ?, ?, ?, ?, ?)
  `).run(input.name, input.capacity, input.areaId ?? null, input.position ?? 0, randomBytes(16).toString('hex'), input.active === false ? 0 : 1, now);
  return listAdminTables(db).find((table) => table.id === Number(result.lastInsertRowid));
}

export function updateTable(db, id, input) {
  const existing = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró la mesa.');
  if (input.name !== undefined) {
    const duplicate = db
      .prepare('SELECT id FROM restaurant_tables WHERE name = ? AND id != ?')
      .get(input.name, id);
    if (duplicate) throw conflict('Ya existe una mesa con ese nombre.');
  }
  if (input.areaId !== undefined && input.areaId !== null) {
    const area = db.prepare('SELECT id FROM areas WHERE id = ?').get(input.areaId);
    if (!area) throw notFound('No se encontró el área.');
  }
  if (input.active === false) {
    const open = db
      .prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'abierta'")
      .get(id);
    if (open) throw conflict('No puedes desactivar una mesa con un pedido abierto.');
  }
  const fields = [];
  const params = [];
  for (const [key, column] of [['name', 'name'], ['capacity', 'capacity'], ['areaId', 'area_id'], ['position', 'position'], ['active', 'active']]) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(key === 'active' ? (input[key] ? 1 : 0) : input[key]);
    }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  params.push(id);
  db.prepare(`UPDATE restaurant_tables SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return listAdminTables(db).find((table) => table.id === Number(id));
}


export function rotateTableQrToken(db, id, now = new Date().toISOString()) {
  const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(id);
  if (!table) throw notFound('No se encontró la mesa.');
  const token = randomBytes(16).toString('hex');
  db.prepare('UPDATE restaurant_tables SET qr_token = ? WHERE id = ?').run(token, id);
  return listAdminTables(db).find((entry) => Number(entry.id) === Number(id));
}
