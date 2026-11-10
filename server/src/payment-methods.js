import { conflict, notFound, unprocessable, validationError } from './errors.js';
import { audit } from './audit.js';

const KINDS = ['cash', 'card', 'transfer', 'other'];

export function serializePaymentMethod(row) {
  return {
    id: Number(row.id),
    code: row.code,
    name: row.name,
    kind: row.kind,
    icon: row.icon,
    allowsPhoto: Boolean(row.allows_photo),
    requiresPhoto: Boolean(row.requires_photo),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
    usageCount: row.usage_count === undefined ? undefined : Number(row.usage_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listPaymentMethods(db, { activeOnly = false } = {}) {
  const rows = db
    .prepare(`
      SELECT pm.*, (SELECT COUNT(*) FROM payments p WHERE p.payment_method = pm.code) AS usage_count
      FROM payment_methods pm
      ${activeOnly ? 'WHERE pm.active = 1' : ''}
      ORDER BY pm.active DESC, pm.sort_order, pm.name
    `)
    .all();
  return rows.map(serializePaymentMethod);
}

export function findPaymentMethod(db, code) {
  const row = db
    .prepare('SELECT * FROM payment_methods WHERE code = ? COLLATE NOCASE')
    .get(String(code));
  return row ? serializePaymentMethod(row) : null;
}

export function resolveActivePaymentMethod(db, code) {
  const method = findPaymentMethod(db, code);
  if (!method || !method.active) {
    throw unprocessable('El método de pago seleccionado no está disponible.');
  }
  return method;
}

function validateMethodInput(input, { partial = false } = {}) {
  if (!partial || input.kind !== undefined) {
    if (!KINDS.includes(input.kind)) throw validationError('Selecciona un tipo de método válido.');
  }
  if (!partial || input.allowsPhoto !== undefined) {
    if (input.requiresPhoto && input.allowsPhoto === false) {
      throw validationError('Un método que exige foto debe permitir adjuntar fotos.');
    }
  }
}

export function createPaymentMethod(db, input, staffId, now = new Date().toISOString()) {
  validateMethodInput(input);
  if (!/^[a-z0-9_]{2,40}$/.test(input.code)) {
    throw validationError('El código debe tener entre 2 y 40 caracteres: minúsculas, números o guion bajo.');
  }
  if (findPaymentMethod(db, input.code)) {
    throw conflict('Ya existe un método de pago con ese código.');
  }
  const allowsPhoto = Boolean(input.allowsPhoto);
  const requiresPhoto = Boolean(input.requiresPhoto);
  if (requiresPhoto && !allowsPhoto) {
    throw validationError('Un método que exige foto debe permitir adjuntar fotos.');
  }
  const result = db.prepare(`
    INSERT INTO payment_methods
      (code, name, kind, icon, allows_photo, requires_photo, active, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.code,
    input.name,
    input.kind,
    input.icon || 'wallet',
    allowsPhoto ? 1 : 0,
    requiresPhoto ? 1 : 0,
    input.active === false ? 0 : 1,
    input.sortOrder ?? 0,
    now,
    now,
  );
  const id = Number(result.lastInsertRowid);
  audit(db, staffId, 'payment_method.create', 'payment_method', id, input);
  return serializePaymentMethod(db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id));
}

export function updatePaymentMethod(db, id, input, staffId, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró el método de pago.');
  validateMethodInput(input, { partial: true });

  const willAllow = input.allowsPhoto ?? Boolean(existing.allows_photo);
  const willRequire = input.requiresPhoto ?? Boolean(existing.requires_photo);
  if (willRequire && !willAllow) {
    throw validationError('Un método que exige foto debe permitir adjuntar fotos.');
  }
  if (input.active === false && existing.active) {
    const activeCount = Number(
      db.prepare('SELECT COUNT(*) AS count FROM payment_methods WHERE active = 1').get().count,
    );
    if (activeCount <= 1) {
      throw conflict('Debe quedar al menos un método de pago activo.');
    }
  }
  if (input.code !== undefined && input.code.toLowerCase() !== existing.code) {
    if (!/^[a-z0-9_]{2,40}$/.test(input.code)) {
      throw validationError('El código no es válido.');
    }
    const duplicate = db
      .prepare('SELECT id FROM payment_methods WHERE code = ? COLLATE NOCASE AND id != ?')
      .get(input.code, id);
    if (duplicate) throw conflict('Ya existe un método de pago con ese código.');
  }

  const fields = [];
  const params = [];
  const mapping = [
    ['code', 'code'],
    ['name', 'name'],
    ['kind', 'kind'],
    ['icon', 'icon'],
    ['allowsPhoto', 'allows_photo'],
    ['requiresPhoto', 'requires_photo'],
    ['active', 'active'],
    ['sortOrder', 'sort_order'],
  ];
  for (const [key, column] of mapping) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      if (['allowsPhoto', 'requiresPhoto', 'active'].includes(key)) {
        params.push(input[key] ? 1 : 0);
      } else {
        params.push(input[key]);
      }
    }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE payment_methods SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  audit(db, staffId, 'payment_method.update', 'payment_method', id, input);
  return serializePaymentMethod(db.prepare('SELECT * FROM payment_methods WHERE id = ?').get(id));
}
