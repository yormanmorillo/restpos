import { calculateTotals } from '@restpos/shared/pricing';
import { conflict, notFound, validationError } from './errors.js';
import { transaction } from './db.js';
import { audit } from './audit.js';

function loadOrder(db, id) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) throw notFound('No se encontró el pedido.');
  return order;
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
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id').all(targetOrderId);
    const totals = calculateTotals({
      items: items.map((item) => ({ unitPriceCents: Number(item.unit_price_cents), quantity: Number(item.quantity) })),
      discountType: target.discount_type,
      discountValue: Number(target.discount_value),
      tipType: target.tip_type,
      tipValue: Number(target.tip_value),
      taxRateBps: Number(target.tax_rate_bps),
    });
    db.prepare(`
      UPDATE orders SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?, tip_cents = ?,
        total_cents = ?, updated_at = ? WHERE id = ?
    `).run(
      totals.subtotalCents, totals.discountCents, totals.taxCents, totals.tipCents,
      totals.totalCents + Number(target.delivery_fee_cents ?? 0), now, targetOrderId,
    );
    db.prepare("UPDATE orders SET status = 'anulada', cancelled_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, sourceOrderId);
    if (source.table_id !== null) {
      db.prepare("UPDATE restaurant_tables SET status = 'libre' WHERE id = ?").run(source.table_id);
    }
    db.prepare('UPDATE orders SET kitchen_sent_at = ? WHERE id = ? AND kitchen_sent_at IS NULL').run(now, targetOrderId);
    audit(db, staffId, 'order.merge', 'order', targetOrderId, {
      sourceOrderId: Number(sourceOrderId),
      itemCount: items.length,
      totalCents: totals.totalCents + Number(target.delivery_fee_cents ?? 0),
    });
  });
  return targetOrderId;
}
