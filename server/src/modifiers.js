import { conflict, notFound, validationError } from './errors.js';

function serializeModifier(row) {
  return {
    id: Number(row.id),
    groupId: Number(row.group_id),
    name: row.name,
    priceDeltaCents: Number(row.price_delta_cents),
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
  };
}

function serializeGroup(row, options = []) {
  return {
    id: Number(row.id),
    name: row.name,
    selectionType: row.selection_type,
    required: Boolean(row.required),
    minSelect: Number(row.min_select),
    maxSelect: Number(row.max_select),
    sortOrder: Number(row.sort_order),
    active: Boolean(row.active),
    options: options.map(serializeModifier),
  };
}

export function listModifierGroups(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE active = 1';
  const groups = db
    .prepare(`SELECT * FROM modifier_groups ${where} ORDER BY sort_order, name`)
    .all();
  const options = db
    .prepare(`
      SELECT m.* FROM modifiers m
      JOIN modifier_groups g ON g.id = m.group_id
      ${includeInactive ? '' : 'WHERE m.active = 1 AND g.active = 1'}
      ORDER BY m.sort_order, m.name
    `)
    .all();
  const byGroup = new Map();
  for (const option of options) {
    const groupId = Number(option.group_id);
    if (!byGroup.has(groupId)) byGroup.set(groupId, []);
    byGroup.get(groupId).push(option);
  }
  return groups.map((group) => serializeGroup(group, byGroup.get(Number(group.id)) ?? []));
}

export function getProductModifierGroups(db, productIds) {
  if (productIds.length === 0) return new Map();
  const all = listModifierGroups(db);
  const assignments = db.prepare(`
    SELECT pmg.product_id, pmg.group_id
    FROM product_modifier_groups pmg
    JOIN modifier_groups g ON g.id = pmg.group_id
    WHERE g.active = 1
  `).all();
  const groupsById = new Map(all.map((group) => [group.id, group]));
  const result = new Map(productIds.map((id) => [Number(id), []]));
  for (const assignment of assignments) {
    const productId = Number(assignment.product_id);
    if (!result.has(productId)) continue;
    const group = groupsById.get(Number(assignment.group_id));
    if (group) result.get(productId).push(group);
  }
  for (const groups of result.values()) {
    groups.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  return result;
}

function validateGroupInput(input) {
  const selectionType = input.selectionType;
  const minSelect = input.minSelect ?? 0;
  const maxSelect = input.maxSelect ?? (selectionType === 'single' ? 1 : 5);
  if (selectionType === 'single' && maxSelect !== 1) {
    throw validationError('Un grupo de selección única debe permitir exactamente una opción.');
  }
  if (minSelect > maxSelect) {
    throw validationError('El mínimo de selecciones no puede superar el máximo.');
  }
  if (input.required && minSelect < 1) {
    throw validationError('Un grupo obligatorio debe exigir al menos una selección.');
  }
  return { selectionType, minSelect, maxSelect, required: Boolean(input.required) };
}

function validateOptions(options) {
  if (!Array.isArray(options) || options.length === 0) {
    throw validationError('Agrega al menos una opción al grupo.');
  }
  const names = new Set();
  return options.map((option, index) => {
    const name = String(option.name ?? '').trim();
    if (!name || name.length > 80) throw validationError('Cada opción necesita un nombre válido.');
    if (names.has(name.toLocaleLowerCase('es'))) {
      throw validationError(`La opción "${name}" está duplicada.`);
    }
    names.add(name.toLocaleLowerCase('es'));
    const priceDeltaCents = option.priceDeltaCents ?? 0;
    if (!Number.isInteger(priceDeltaCents) || priceDeltaCents < 0 || priceDeltaCents > 100_000) {
      throw validationError('El precio adicional de una opción no es válido.');
    }
    return {
      name,
      priceDeltaCents,
      sortOrder: option.sortOrder ?? index * 10,
      active: option.active !== false,
    };
  });
}

function insertOptions(db, groupId, options, now) {
  const statement = db.prepare(`
    INSERT INTO modifiers (group_id, name, price_delta_cents, sort_order, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const option of options) {
    statement.run(groupId, option.name, option.priceDeltaCents, option.sortOrder, option.active ? 1 : 0, now, now);
  }
}

export function createModifierGroup(db, input, now = new Date().toISOString()) {
  const existing = db
    .prepare('SELECT id FROM modifier_groups WHERE name = ? COLLATE NOCASE')
    .get(input.name);
  if (existing) throw conflict('Ya existe un grupo de modificadores con ese nombre.');
  const config = validateGroupInput(input);
  const options = validateOptions(input.options);
  let groupId;
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`
      INSERT INTO modifier_groups
        (name, selection_type, required, min_select, max_select, sort_order, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.name,
      config.selectionType,
      config.required ? 1 : 0,
      config.minSelect,
      config.maxSelect,
      input.sortOrder ?? 0,
      input.active === false ? 0 : 1,
      now,
      now,
    );
    groupId = Number(result.lastInsertRowid);
    insertOptions(db, groupId, options, now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return listModifierGroups(db, { includeInactive: true }).find((group) => group.id === groupId);
}

export function updateModifierGroup(db, id, input, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM modifier_groups WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró el grupo de modificadores.');
  if (input.name !== undefined) {
    const duplicate = db
      .prepare('SELECT id FROM modifier_groups WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(input.name, id);
    if (duplicate) throw conflict('Ya existe un grupo de modificadores con ese nombre.');
  }
  const selectionType = input.selectionType ?? existing.selection_type;
  const minSelect = input.minSelect ?? Number(existing.min_select);
  const maxSelect = input.maxSelect ?? Number(existing.max_select);
  const required = input.required ?? Boolean(existing.required);
  const config = validateGroupInput({ selectionType, minSelect, maxSelect, required });
  const options = input.options ? validateOptions(input.options) : null;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE modifier_groups SET
        name = ?, selection_type = ?, required = ?, min_select = ?, max_select = ?,
        sort_order = ?, active = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.name ?? existing.name,
      config.selectionType,
      config.required ? 1 : 0,
      config.minSelect,
      config.maxSelect,
      input.sortOrder ?? Number(existing.sort_order),
      input.active === undefined ? Number(existing.active) : input.active ? 1 : 0,
      now,
      id,
    );
    if (options) {
      db.prepare('DELETE FROM modifiers WHERE group_id = ?').run(id);
      insertOptions(db, Number(id), options, now);
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return listModifierGroups(db, { includeInactive: true }).find((group) => group.id === Number(id));
}

export function setProductModifierGroups(db, productId, groupIds) {
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  if (!product) throw notFound('No se encontró el producto.');
  const groups = db
    .prepare(`SELECT id FROM modifier_groups WHERE id IN (${groupIds.map(() => '?').join(',') || 'NULL'})`)
    .all(...groupIds);
  if (groups.length !== groupIds.length) throw validationError('Uno de los grupos no existe.');
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM product_modifier_groups WHERE product_id = ?').run(productId);
    const insert = db.prepare(
      'INSERT INTO product_modifier_groups (product_id, group_id, sort_order) VALUES (?, ?, ?)',
    );
    groupIds.forEach((groupId, index) => insert.run(productId, groupId, index * 10));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return getProductModifierGroups(db, [Number(productId)]).get(Number(productId)) ?? [];
}

export function resolveSelectedModifiers(db, productId, selectedIds = []) {
  if (!Array.isArray(selectedIds)) {
    throw validationError('La selección de modificadores no es válida.');
  }
  const ids = [...new Set(selectedIds.map(Number))];
  if (ids.length !== selectedIds.length || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw validationError('La selección de modificadores no es válida.');
  }
  const assigned = getProductModifierGroups(db, [Number(productId)]).get(Number(productId)) ?? [];
  const assignedIds = new Set(assigned.map((group) => group.id));
  const selectedByGroup = new Map();
  for (const id of ids) {
    let found = null;
    for (const group of assigned) {
      const option = group.options.find((item) => item.id === id);
      if (option) {
        found = { group, option };
        break;
      }
    }
    if (!found || !assignedIds.has(found.group.id)) {
      throw validationError('Uno de los modificadores no pertenece a este producto.');
    }
    if (!selectedByGroup.has(found.group.id)) selectedByGroup.set(found.group.id, []);
    selectedByGroup.get(found.group.id).push(found.option);
  }
  const modifiers = [];
  for (const group of assigned) {
    const selected = selectedByGroup.get(group.id) ?? [];
    if (selected.length < group.minSelect || selected.length > group.maxSelect) {
      throw validationError(
        `"${group.name}" requiere entre ${group.minSelect} y ${group.maxSelect} selecciones.`,
      );
    }
    if (group.selectionType === 'single' && selected.length > 1) {
      throw validationError(`"${group.name}" solo permite una opción.`);
    }
    for (const option of selected) {
      modifiers.push({
        modifierId: option.id,
        groupName: group.name,
        modifierName: option.name,
        priceDeltaCents: option.priceDeltaCents,
      });
    }
  }
  const modifiersTotalCents = modifiers.reduce((sum, item) => sum + item.priceDeltaCents, 0);
  return { modifiers, modifiersTotalCents };
}
