import { conflict, notFound, validationError } from './errors.js';
import { audit } from './audit.js';
import { transaction } from './db.js';

function allocate(total, weights) {
  const safeTotal = Math.max(0, Math.round(Number(total)));
  const cleanWeights = weights.map((value) => Math.max(0, Number(value)));
  const weightSum = cleanWeights.reduce((sum, value) => sum + value, 0);
  if (safeTotal === 0) return cleanWeights.map(() => 0);
  if (weightSum === 0) {
    const base = Math.floor(safeTotal / cleanWeights.length);
    const result = cleanWeights.map(() => base);
    result[0] += safeTotal - base * result.length;
    return result;
  }
  const raw = cleanWeights.map((weight) => (safeTotal * weight) / weightSum);
  const result = raw.map((value) => Math.floor(value));
  let remaining = safeTotal - result.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; remaining > 0; index += 1) {
    result[order[index % order.length].index] += 1;
    remaining -= 1;
  }
  return result;
}

function splitItems(db, splitId) {
  return db
    .prepare('SELECT id, product_name, quantity, line_total_cents, notes FROM order_items WHERE split_id = ? ORDER BY sort_order, id')
    .all(splitId)
    .map((item) => ({
      id: Number(item.id),
      productName: item.product_name,
      quantity: Number(item.quantity),
      lineTotalCents: Number(item.line_total_cents),
      notes: item.notes,
    }));
}

export function serializeSplit(row, items = []) {
  const totalCents = Number(row.total_cents);
  const amountPaidCents = Number(row.amount_paid_cents);
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    label: row.label,
    status: row.status,
    totalCents,
    amountPaidCents,
    balanceCents: Math.max(0, totalCents - amountPaidCents),
    createdAt: row.created_at,
    paidAt: row.paid_at ?? null,
    items,
  };
}

export function listOrderSplits(db, orderId) {
  const rows = db.prepare('SELECT * FROM order_splits WHERE order_id = ? ORDER BY id').all(orderId);
  return rows.map((row) => serializeSplit(row, splitItems(db, row.id)));
}

export function createOrderSplits(db, orderId, groups, staffId, now = new Date().toISOString()) {
  if (!Array.isArray(groups) || groups.length < 2 || groups.length > 20) {
    throw validationError('Crea entre 2 y 20 partes para dividir la cuenta.');
  }
  return transaction(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw notFound('No se encontró el pedido.');
    if (order.status !== 'abierta') throw conflict('El pedido ya está cerrado.');
    if (Number(order.amount_paid_cents) > 0) throw conflict('No se puede dividir un pedido con pagos registrados.');
    if (Number(order.discount_cents) > 0 || Number(order.tip_cents) > 0) {
      throw conflict('Quita el descuento y la propina antes de dividir la cuenta.');
    }
    if (db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(orderId).count > 0) {
      throw conflict('La cuenta ya está dividida.');
    }
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id').all(orderId);
    if (items.length < 2) throw validationError('Agrega al menos dos productos para dividir la cuenta.');
    const itemMap = new Map(items.map((item) => [Number(item.id), item]));
    const assigned = new Set();
    const normalized = groups.map((group, index) => {
      const label = String(group.label ?? '').trim().slice(0, 40) || `Parte ${index + 1}`;
      const itemIds = [...new Set((group.itemIds ?? []).map(Number))];
      if (itemIds.length === 0) throw validationError(`La parte "${label}" no tiene productos.`);
      for (const itemId of itemIds) {
        if (!itemMap.has(itemId)) throw validationError('Uno de los productos no pertenece al pedido.');
        if (assigned.has(itemId)) throw validationError('Un producto no puede estar en dos partes.');
        assigned.add(itemId);
      }
      const subtotalCents = itemIds.reduce((sum, itemId) => sum + Number(itemMap.get(itemId).line_total_cents), 0);
      return { label, itemIds, subtotalCents };
    });
    if (assigned.size !== items.length) throw validationError('Asigna todos los productos a una parte.');
    const tax = allocate(Number(order.tax_cents), normalized.map((group) => group.subtotalCents));
    const delivery = allocate(Number(order.delivery_fee_cents), normalized.map((group) => group.subtotalCents));
    const insert = db.prepare(`
      INSERT INTO order_splits (order_id, label, total_cents, created_at, created_by_staff_id)
      VALUES (?, ?, ?, ?, ?)
    `);
    const assign = db.prepare('UPDATE order_items SET split_id = ? WHERE id = ? AND order_id = ?');
    normalized.forEach((group, index) => {
      const totalCents = group.subtotalCents + tax[index] + delivery[index];
      const result = insert.run(orderId, group.label, totalCents, now, staffId);
      for (const itemId of group.itemIds) assign.run(Number(result.lastInsertRowid), itemId, orderId);
    });
    audit(db, staffId, 'order.split.create', 'order', orderId, {
      splitCount: normalized.length,
      totalCents: Number(order.total_cents),
      labels: normalized.map((group) => group.label),
    });
    return listOrderSplits(db, orderId);
  });
}


export function clearOrderSplits(db, orderId, staffId, now = new Date().toISOString()) {
  return transaction(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw notFound('No se encontró el pedido.');
    if (order.status !== 'abierta') throw conflict('El pedido ya está cerrado.');
    if (Number(order.amount_paid_cents) > 0) throw conflict('No se puede deshacer una división con pagos registrados.');
    const count = Number(db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(orderId).count);
    if (count === 0) throw conflict('El pedido no está dividido.');
    db.prepare('UPDATE order_items SET split_id = NULL WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM order_splits WHERE order_id = ?').run(orderId);
    audit(db, staffId, 'order.split.clear', 'order', orderId, { splitCount: count });
    return listOrderSplits(db, orderId);
  });
}
