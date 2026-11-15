import { randomBytes } from 'node:crypto';
import { conflict, notFound, validationError } from './errors.js';
import { audit } from './audit.js';

export function serializeGiftCard(row) {
  return {
    id: Number(row.id),
    code: row.code,
    initialCents: Number(row.initial_cents),
    balanceCents: Number(row.balance_cents),
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    customerName: row.customer_name ?? null,
    active: Boolean(row.active),
    expiresAt: row.expires_at ?? null,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

function newCode() {
  return `GC-${randomBytes(5).toString('hex').toUpperCase()}`;
}

export function listGiftCards(db) {
  return db.prepare(`
    SELECT gc.*, c.name AS customer_name FROM gift_cards gc
    LEFT JOIN customers c ON c.id = gc.customer_id
    ORDER BY gc.active DESC, gc.created_at DESC
  `).all().map(serializeGiftCard);
}

export function findGiftCard(db, code) {
  const row = db.prepare(`
    SELECT gc.*, c.name AS customer_name FROM gift_cards gc
    LEFT JOIN customers c ON c.id = gc.customer_id
    WHERE gc.code = ? COLLATE NOCASE
  `).get(String(code ?? '').trim());
  return row ? serializeGiftCard(row) : null;
}

export function createGiftCard(db, input, staffId, now = new Date().toISOString()) {
  const amount = Number(input.amountCents);
  if (!Number.isInteger(amount) || amount <= 0) throw validationError('El monto de la gift card debe ser positivo.');
  const code = String(input.code ?? '').trim() || newCode();
  if (db.prepare('SELECT id FROM gift_cards WHERE code = ? COLLATE NOCASE').get(code)) throw conflict('Ya existe una gift card con ese código.');
  const result = db.prepare(`
    INSERT INTO gift_cards (code, initial_cents, balance_cents, customer_id, active, expires_at, notes, created_by_staff_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, amount, amount, input.customerId ?? null, input.active === false ? 0 : 1, input.expiresAt ?? null, input.notes ?? '', staffId, now, now);
  const id = Number(result.lastInsertRowid);
  audit(db, staffId, 'gift_card.create', 'gift_card', id, { code, amountCents: amount });
  return findGiftCard(db, code);
}

export function updateGiftCard(db, id, input, staffId, now = new Date().toISOString()) {
  const row = db.prepare('SELECT * FROM gift_cards WHERE id = ?').get(id);
  if (!row) throw notFound('No se encontró la gift card.');
  const fields = [];
  const params = [];
  if (input.active !== undefined) { fields.push('active = ?'); params.push(input.active ? 1 : 0); }
  if (input.notes !== undefined) { fields.push('notes = ?'); params.push(String(input.notes).trim()); }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE gift_cards SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  audit(db, staffId, 'gift_card.update', 'gift_card', id, input);
  return findGiftCard(db, row.code);
}

export function redeemGiftCard(db, code, amountCents, now = new Date().toISOString()) {
  const card = findGiftCard(db, code);
  if (!card) throw notFound('No se encontró la gift card.');
  if (!card.active) throw conflict('La gift card está desactivada.');
  if (card.expiresAt && new Date(card.expiresAt).getTime() < new Date(now).getTime()) throw conflict('La gift card está vencida.');
  if (card.balanceCents < amountCents) throw conflict('La gift card no tiene saldo suficiente.');
  db.prepare('UPDATE gift_cards SET balance_cents = balance_cents - ?, updated_at = ? WHERE id = ?').run(amountCents, now, card.id);
  return { ...card, balanceCents: card.balanceCents - amountCents };
}
