import { conflict, notFound, validationError } from './errors.js';

export function serializeKitchenStation(row) {
  return {
    id: Number(row.id),
    name: row.name,
    color: row.color,
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listKitchenStations(db, { activeOnly = false } = {}) {
  return db
    .prepare(`SELECT * FROM kitchen_stations ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY active DESC, sort_order, name`)
    .all()
    .map(serializeKitchenStation);
}

export function createKitchenStation(db, input, now = new Date().toISOString()) {
  const name = String(input.name ?? '').trim();
  if (!name) throw validationError('El nombre de la estación es obligatorio.');
  if (db.prepare('SELECT id FROM kitchen_stations WHERE name = ? COLLATE NOCASE').get(name)) throw conflict('Ya existe una estación con ese nombre.');
  const result = db.prepare(`
    INSERT INTO kitchen_stations (name, color, sort_order, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, input.color || '#c45d3a', input.sortOrder ?? 0, input.active === false ? 0 : 1, now, now);
  return serializeKitchenStation(db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(Number(result.lastInsertRowid)));
}

export function updateKitchenStation(db, id, input, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró la estación.');
  if (input.name !== undefined) {
    const duplicate = db.prepare('SELECT id FROM kitchen_stations WHERE name = ? COLLATE NOCASE AND id != ?').get(input.name.trim(), id);
    if (duplicate) throw conflict('Ya existe una estación con ese nombre.');
  }
  const fields = [];
  const params = [];
  const mapping = [['name', 'name'], ['color', 'color'], ['sortOrder', 'sort_order'], ['active', 'active']];
  for (const [key, column] of mapping) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(key === 'active' ? (input[key] ? 1 : 0) : key === 'name' ? input[key].trim() : input[key]);
    }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE kitchen_stations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return serializeKitchenStation(db.prepare('SELECT * FROM kitchen_stations WHERE id = ?').get(id));
}
