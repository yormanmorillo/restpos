import { notFound, validationError } from './errors.js';
import { audit } from './audit.js';

const MASK = '••••••••';

export function serializeIntegration(row) {
  return {
    id: Number(row.id),
    name: row.name,
    category: row.category,
    baseUrl: row.base_url,
    authType: row.auth_type,
    apiKeyMasked: row.api_key ? `${MASK}${row.api_key.slice(-4)}` : '',
    hasApiKey: Boolean(row.api_key),
    active: Boolean(row.active),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listIntegrations(db) {
  return db.prepare('SELECT * FROM integrations ORDER BY active DESC, name').all().map(serializeIntegration);
}

export function createIntegration(db, input, staffId, now = new Date().toISOString()) {
  if (input.baseUrl && !/^https?:\/\/.+/i.test(input.baseUrl)) {
    throw validationError('La URL debe comenzar con http:// o https://.');
  }
  const result = db.prepare(`
    INSERT INTO integrations (name, category, base_url, auth_type, api_key, active, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.name,
    input.category,
    input.baseUrl ?? '',
    input.authType ?? 'none',
    input.apiKey ?? '',
    input.active === false ? 0 : 1,
    input.notes ?? '',
    now,
    now,
  );
  const id = Number(result.lastInsertRowid);
  audit(db, staffId, 'integration.create', 'integration', id, { name: input.name, category: input.category });
  return serializeIntegration(db.prepare('SELECT * FROM integrations WHERE id = ?').get(id));
}

export function updateIntegration(db, id, input, staffId, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM integrations WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró la integración.');
  if (input.baseUrl && !/^https?:\/\/.+/i.test(input.baseUrl)) {
    throw validationError('La URL debe comenzar con http:// o https://.');
  }
  const fields = [];
  const params = [];
  const mapping = [
    ['name', 'name'],
    ['category', 'category'],
    ['baseUrl', 'base_url'],
    ['authType', 'auth_type'],
    ['active', 'active'],
    ['notes', 'notes'],
  ];
  for (const [key, column] of mapping) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(key === 'active' ? (input[key] ? 1 : 0) : input[key]);
    }
  }
  if (input.apiKey !== undefined && input.apiKey !== '') {
    fields.push('api_key = ?');
    params.push(input.apiKey);
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE integrations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  audit(db, staffId, 'integration.update', 'integration', id, { name: input.name });
  return serializeIntegration(db.prepare('SELECT * FROM integrations WHERE id = ?').get(id));
}
