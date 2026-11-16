import { randomUUID } from 'node:crypto';
import { conflict, notFound, validationError } from './errors.js';
import { createOrder, updateOrderDraft } from './orders.js';

export function findTableByToken(db, token) {
  const table = db.prepare(`
    SELECT t.*, a.name AS area_name
    FROM restaurant_tables t LEFT JOIN areas a ON a.id = t.area_id
    WHERE t.qr_token = ? AND t.active = 1
  `).get(String(token ?? '').trim());
  if (!table) throw notFound('El QR de la mesa no es válido o la mesa está inactiva.');
  return table;
}

export function createQrTableOrder(db, config, token, input) {
  const table = findTableByToken(db, token);
  let order = db.prepare("SELECT * FROM orders WHERE table_id = ? AND status = 'abierta'").get(table.id);
  if (order && (Number(order.amount_paid_cents) > 0 || db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(order.id).count > 0)) {
    throw conflict('La cuenta de esta mesa ya está en cobro. Pide apoyo al mesero.');
  }
  const lines = input.items.map((item) => ({
    clientKey: `qr-${randomUUID()}`,
    productId: item.productId,
    quantity: item.quantity,
    notes: item.notes ?? '',
  }));
  if (order) {
    const existing = db.prepare('SELECT client_key, product_id, quantity, notes, course FROM order_items WHERE order_id = ?').all(order.id);
    const items = existing.map((item) => ({ clientKey: item.client_key, productId: item.product_id, quantity: item.quantity, notes: item.notes, course: item.course })).concat(lines);
    updateOrderDraft(db, config, order.id, {
      items,
      customerName: input.customerName ?? order.customer_name,
      notes: input.notes ?? order.notes,
    }, { staffId: null, staffRole: 'server' });
  } else {
    order = createOrder(db, config, {
      type: 'mesa', tableId: table.id, customerName: input.customerName ?? '',
      notes: input.notes ?? '', source: 'qr',
    }, { staffId: null });
    updateOrderDraft(db, config, order.id, { items: lines }, { staffId: null, staffRole: 'server' });
  }
  return { table, orderId: Number(order.id) };
}
