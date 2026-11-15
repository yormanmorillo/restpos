import { calculateTotals } from '@restpos/shared/pricing';
import { conflict, notFound, validationError } from './errors.js';
import { transaction } from './db.js';
import { audit } from './audit.js';

function loadOrder(db, id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) throw notFound('No se encontró el pedido.');
  return order;
}

function recalculateOrder(db, orderId, now) {
  const order = loadOrder(db, orderId);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id').all(orderId);
  const totals = calculateTotals({
    items: items.map((item) => ({ unitPriceCents: Number(item.unit_price_cents), quantity: Number(item.quantity) })),
    discountType: order.discount_type,
    discountValue: Number(order.discount_value),
    tipType: order.tip_type,
    tipValue: Number(order.tip_value),
    taxRateBps: Number(order.tax_rate_bps),
  });
  const totalCents = totals.totalCents + Number(order.delivery_fee_cents ?? 0);
  db.prepare(`
    UPDATE orders SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, tip_cents = ?,
      total_cents = ?, updated_at = ? WHERE id = ?
  `).run(totals.subtotalCents, totals.discountCents, totals.taxCents, totals.tipCents, totalCents, now, orderId);
  return { totalCents, itemCount: items.length };
}

export function transferItems(db, sourceOrderId, targetOrderId, itemIds, staffId, now = new Date().toISOString()) {
  if (Number(sourceOrderId) === Number(targetOrderId)) throw validationError('Selecciona dos pedidos distintos.');
  const selected = [...new Set((itemIds ?? []).map(Number))];
  if (selected.length === 0) throw validationError('Selecciona al menos un producto.');
  transaction(db, () => {
    const source = loadOrder(db, sourceOrderId);
    const target = loadOrder(db, targetOrderId);
    for (const [label, order] of [['origen', source], ['destino', target]]) {
      if (order.status !== 'abierta') throw conflict(`El pedido ${label} ya está cerrado.`);
      if (Number(order.amount_paid_cents) > 0) throw conflict(`El pedido ${label} tiene pagos registrados.`);
      if (db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(order.id).count > 0) {
        throw conflict(`El pedido ${label} tiene la cuenta dividida.`);
      }
    }
    const sourceItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND id IN (' + selected.map(() => '?').join(',') + ')').all(sourceOrderId, ...selected);
    if (sourceItems.length !== selected.length) throw validationError('Uno de los productos no pertenece al pedido origen.');
    for (const item of sourceItems) {
      db.prepare('UPDATE order_items SET client_key = ? WHERE id = ?')
        .run(`s${sourceOrderId}-${item.client_key}`.slice(0, 80), item.id);
    }
    db.prepare('UPDATE order_items SET order_id = ? WHERE order_id = ? AND id IN (' + selected.map(() => '?').join(',') + ')')
      .run(targetOrderId, sourceOrderId, ...selected);
    const sourceResult = recalculateOrder(db, sourceOrderId, now);
    const targetResult = recalculateOrder(db, targetOrderId, now);
    if (sourceResult.itemCount === 0) {
      db.prepare("UPDATE orders SET status = 'anulada', cancelled_at = ?, updated_at = ? WHERE id = ?").run(now, now, sourceOrderId);
      if (source.table_id !== null) {
        db.prepare("UPDATE restaurant_tables SET status = 'libre' WHERE id = ?").run(source.table_id);
      }
    }
    audit(db, staffId, 'order.transfer_items', 'order', targetOrderId, {
      sourceOrderId: Number(sourceOrderId),
      itemIds: selected,
      targetTotalCents: targetResult.totalCents,
      sourceTotalCents: sourceResult.totalCents,
    });
  });
  return targetOrderId;
}

export function moveOrderToTable(db, orderId, tableId, staffId, now = new Date().toISOString()) {
  transaction(db, () => {
    const order = loadOrder(db, orderId);
    if (order.status !== 'abierta') throw conflict('Solo se pueden mover pedidos abiertos.');
    if (order.type !== 'mesa') throw conflict('Solo los pedidos de mesa se pueden mover.');
    const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ? AND active = 1').get(tableId);
    if (!table) throw notFound('No se encontró la mesa destino.');
    if (Number(order.table_id) === Number(tableId)) return;
    if (table.status === 'ocupada') throw conflict('La mesa destino está ocupada.');
    const previousTableId = Number(order.table_id);
    db.prepare("UPDATE restaurant_tables SET status = 'libre' WHERE id = ?").run(previousTableId);
    db.prepare("UPDATE restaurant_tables SET status = 'ocupada' WHERE id = ?").run(tableId);
    db.prepare('UPDATE orders SET table_id = ?, updated_at = ? WHERE id = ?').run(tableId, now, orderId);
    audit(db, staffId, 'order.move_table', 'order', orderId, {
      fromTableId: previousTableId,
      toTableId: Number(tableId),
    });
  });
  return orderId;
}

export function mergeOrders(db, targetOrderId, sourceOrderId, staffId, now = new Date().toISOString()) {
  if (Number(targetOrderId) === Number(sourceOrderId)) throw validationError('Selecciona dos pedidos distintos.');
  transaction(db, () => {
    const target = loadOrder(db, targetOrderId);
    const source = loadOrder(db, sourceOrderId);
    for (const [label, order] of [['destino', target], ['origen', source]]) {
      if (order.status !== 'abierta') throw conflict(`El pedido ${label} ya está cerrado.`);
      if (Number(order.amount_paid_cents) > 0) throw conflict(`El pedido ${label} tiene pagos registrados.`);
      if (db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(order.id).count > 0) {
        throw conflict(`El pedido ${label} tiene la cuenta dividida.`);
      }
    }
    const sourceItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id').all(sourceOrderId);
    if (sourceItems.length === 0) throw conflict('El pedido origen no tiene productos.');
    // Prefix client keys while the items still belong to the source order.
    for (const item of sourceItems) {
      db.prepare('UPDATE order_items SET client_key = ? WHERE id = ?')
        .run(`s${sourceOrderId}-${item.client_key}`.slice(0, 80), item.id);
    }
    db.prepare('UPDATE order_items SET order_id = ? WHERE order_id = ?').run(targetOrderId, sourceOrderId);
    const targetResult = recalculateOrder(db, targetOrderId, now);
    db.prepare("UPDATE orders SET status = 'anulada', cancelled_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, sourceOrderId);
    if (source.table_id !== null) {
      db.prepare("UPDATE restaurant_tables SET status = 'libre' WHERE id = ?").run(source.table_id);
    }
    db.prepare('UPDATE orders SET kitchen_sent_at = ? WHERE id = ? AND kitchen_sent_at IS NULL').run(now, targetOrderId);
    audit(db, staffId, 'order.merge', 'order', targetOrderId, {
      sourceOrderId: Number(sourceOrderId),
      itemCount: sourceItems.length,
      totalCents: targetResult.totalCents,
    });
  });
  return targetOrderId;
}
