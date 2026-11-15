import { conflict, notFound, validationError } from './errors.js';
import { transaction } from './db.js';
import { audit } from './audit.js';

const STATUSES = ['pending', 'confirmed', 'seated', 'cancelled', 'no_show'];

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) throw validationError('La fecha de la reserva no es válida.');
}
function assertTime(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value ?? ''))) throw validationError('La hora de la reserva no es válida.');
}

function serializeReservation(row) {
  return {
    id: Number(row.id),
    customerId: row.customer_id === null ? null : Number(row.customer_id),
    name: row.name,
    phone: row.phone,
    partySize: Number(row.party_size),
    date: row.reservation_date,
    time: row.reservation_time,
    tableId: row.table_id === null ? null : Number(row.table_id),
    tableName: row.table_name ?? null,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeWaitlist(row) {
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone,
    partySize: Number(row.party_size),
    quotedMinutes: Number(row.quoted_minutes),
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    seatedAt: row.seated_at,
  };
}

export function listReservations(db, { date = null, status = null } = {}) {
  const clauses = [];
  const params = [];
  if (date) { clauses.push('r.reservation_date = ?'); params.push(date); }
  if (status) { clauses.push('r.status = ?'); params.push(status); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT r.*, t.name AS table_name
    FROM reservations r
    LEFT JOIN restaurant_tables t ON t.id = r.table_id
    ${where}
    ORDER BY r.reservation_date, r.reservation_time, r.id
  `).all(...params).map(serializeReservation);
}

export function createReservation(db, input, staffId, now = new Date().toISOString()) {
  assertDate(input.date); assertTime(input.time);
  if (input.tableId) {
    const table = db.prepare('SELECT id FROM restaurant_tables WHERE id = ? AND active = 1').get(input.tableId);
    if (!table) throw notFound('No se encontró la mesa.');
  }
  const result = db.prepare(`
    INSERT INTO reservations
      (customer_id, name, phone, party_size, reservation_date, reservation_time, table_id, status, notes, created_by_staff_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.customerId ?? null, input.name.trim(), input.phone ?? '', input.partySize,
    input.date, input.time, input.tableId ?? null, input.status ?? 'pending', input.notes ?? '', staffId, now, now,
  );
  const id = Number(result.lastInsertRowid);
  audit(db, staffId, 'reservation.create', 'reservation', id, { date: input.date, time: input.time, partySize: input.partySize });
  return listReservations(db, { date: input.date }).find((entry) => entry.id === id);
}

export function updateReservation(db, id, input, staffId, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró la reserva.');
  if (input.status && !STATUSES.includes(input.status)) throw validationError('Estado de reserva inválido.');
  if (input.date) assertDate(input.date);
  if (input.time) assertTime(input.time);
  const fields = [];
  const params = [];
  const mapping = [['name', 'name'], ['phone', 'phone'], ['partySize', 'party_size'], ['date', 'reservation_date'], ['time', 'reservation_time'], ['tableId', 'table_id'], ['status', 'status'], ['notes', 'notes']];
  for (const [key, column] of mapping) {
    if (input[key] !== undefined) { fields.push(`${column} = ?`); params.push(input[key]); }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE reservations SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  audit(db, staffId, 'reservation.update', 'reservation', id, input);
  return listReservations(db, { date: input.date ?? existing.reservation_date }).find((entry) => entry.id === id);
}

export function listWaitlist(db, { status = 'waiting' } = {}) {
  return db.prepare(`
    SELECT * FROM waitlist_entries ${status ? 'WHERE status = ?' : ''}
    ORDER BY created_at, id
  `).all(...(status ? [status] : [])).map(serializeWaitlist);
}

export function createWaitlistEntry(db, input, staffId, now = new Date().toISOString()) {
  const result = db.prepare(`
    INSERT INTO waitlist_entries
      (name, phone, party_size, quoted_minutes, notes, created_by_staff_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.name.trim(), input.phone ?? '', input.partySize, input.quotedMinutes ?? 0, input.notes ?? '', staffId, now);
  const id = Number(result.lastInsertRowid);
  audit(db, staffId, 'waitlist.create', 'waitlist', id, { partySize: input.partySize });
  return listWaitlist(db).find((entry) => entry.id === id);
}

export function updateWaitlistEntry(db, id, status, staffId, now = new Date().toISOString()) {
  if (!['waiting', 'seated', 'cancelled'].includes(status)) throw validationError('Estado de lista de espera inválido.');
  const existing = db.prepare('SELECT * FROM waitlist_entries WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró la entrada.');
  db.prepare('UPDATE waitlist_entries SET status = ?, seated_at = ? WHERE id = ?')
    .run(status, status === 'seated' ? now : existing.seated_at, id);
  audit(db, staffId, `waitlist.${status}`, 'waitlist', id, {});
  return serializeWaitlist(db.prepare('SELECT * FROM waitlist_entries WHERE id = ?').get(id));
}
