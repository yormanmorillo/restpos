import { conflict, notFound, validationError } from './errors.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';

export function serializeCustomer(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    notes: row.notes ?? '',
    pointsBalance: Number(row.points_balance ?? 0),
    totalSpentCents: Number(row.total_spent_cents ?? 0),
    visits: Number(row.visits ?? 0),
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listCustomers(db, { query = '', limit = 50 } = {}) {
  const q = String(query ?? '').trim();
  const rows = q
    ? db.prepare(`
        SELECT * FROM customers
        WHERE active = 1 AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)
        ORDER BY name LIMIT ?
      `).all(`%${q}%`, `%${q}%`, `%${q}%`, Math.min(100, Math.max(1, Number(limit) || 50)))
    : db.prepare('SELECT * FROM customers ORDER BY active DESC, name LIMIT ?').all(Math.min(100, Math.max(1, Number(limit) || 50)));
  return rows.map(serializeCustomer);
}

export function getCustomer(db, id) {
  const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!row) throw notFound('No se encontró el cliente.');
  const orders = db.prepare(`
    SELECT id, order_number, status, total_cents, paid_at, created_at, table_id, type
    FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(id).map((order) => ({
    id: Number(order.id), orderNumber: order.order_number, status: order.status,
    totalCents: Number(order.total_cents), paidAt: order.paid_at, createdAt: order.created_at,
  }));
  return { ...serializeCustomer(row), orders };
}

export function createCustomer(db, input, staffId, now = new Date().toISOString()) {
  const name = String(input.name ?? '').trim();
  if (!name) throw validationError('El nombre del cliente es obligatorio.');
  const phone = String(input.phone ?? '').trim();
  if (phone && db.prepare('SELECT id FROM customers WHERE phone = ? AND active = 1').get(phone)) throw conflict('Ya existe un cliente con ese teléfono.');
  const result = db.prepare(`
    INSERT INTO customers (name, phone, email, notes, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(name, phone, String(input.email ?? '').trim(), String(input.notes ?? '').trim(), now, now);
  const id = Number(result.lastInsertRowid);
  audit(db, staffId, 'customer.create', 'customer', id, { name, phone });
  return serializeCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
}

export function updateCustomer(db, id, input, staffId, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró el cliente.');
  if (input.phone !== undefined) {
    const phone = String(input.phone).trim();
    if (phone && db.prepare('SELECT id FROM customers WHERE phone = ? AND id != ?').get(phone, id)) throw conflict('Ya existe un cliente con ese teléfono.');
  }
  const fields = [];
  const params = [];
  for (const [key, column] of [['name', 'name'], ['phone', 'phone'], ['email', 'email'], ['notes', 'notes'], ['active', 'active']]) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(key === 'active' ? (input[key] ? 1 : 0) : String(input[key]).trim());
    }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  audit(db, staffId, 'customer.update', 'customer', id, input);
  return serializeCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(id));
}

export function awardLoyaltyForOrder(db, orderId, now = new Date().toISOString()) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || !order.customer_id || Number(order.loyalty_awarded) === 1) return 0;
  const rate = Math.max(0, Number(getSetting(db, 'loyalty_points_per_1000_cents', '1')) || 0);
  const points = Math.floor(Number(order.total_cents) / 1000) * rate;
  db.prepare(`
    UPDATE customers SET points_balance = points_balance + ?, total_spent_cents = total_spent_cents + ?,
      visits = visits + 1, updated_at = ? WHERE id = ?
  `).run(points, Number(order.total_cents), now, order.customer_id);
  db.prepare('UPDATE orders SET loyalty_points_earned = ?, loyalty_awarded = 1 WHERE id = ?').run(points, orderId);
  return points;
}

export function reverseLoyaltyForOrder(db, orderId, now = new Date().toISOString()) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order || !order.customer_id || Number(order.loyalty_awarded) !== 1) return;
  const points = Number(order.loyalty_points_earned ?? 0);
  const redeemed = Number(order.loyalty_points_redeemed ?? 0);
  db.prepare(`
    UPDATE customers SET points_balance = MAX(0, points_balance - ? + ?),
      total_spent_cents = MAX(0, total_spent_cents - ?), updated_at = ? WHERE id = ?
  `).run(points, redeemed, Number(order.total_cents), now, order.customer_id);
  db.prepare('UPDATE orders SET loyalty_points_earned = 0, loyalty_points_redeemed = 0, loyalty_awarded = 0 WHERE id = ?').run(orderId);
}
