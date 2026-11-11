import { notFound, validationError } from './errors.js';
import { transaction } from './db.js';
import { audit } from './audit.js';
import { getOrder } from './orders.js';

const ITEM_STATUSES = ['sent', 'preparing', 'ready', 'served'];

function attachModifiers(db, items) {
  if (items.length === 0) return items;
  const placeholders = items.map(() => '?').join(',');
  const modifiers = db
    .prepare(`SELECT * FROM order_item_modifiers WHERE order_item_id IN (${placeholders}) ORDER BY id`)
    .all(...items.map((item) => item.id));
  const byItem = new Map();
  for (const modifier of modifiers) {
    const id = Number(modifier.order_item_id);
    if (!byItem.has(id)) byItem.set(id, []);
    byItem.get(id).push(modifier);
  }
  return items.map((item) => ({ ...item, modifiers: byItem.get(Number(item.id)) ?? [] }));
}

export function getKitchenTickets(db) {
  const orders = db
    .prepare(`
      SELECT o.id, o.order_number, o.type, o.table_id, o.source, o.delivery,
             o.customer_name, o.notes, o.kitchen_sent_at, o.created_at, o.status,
             o.total_cents, o.amount_paid_cents,
             t.name AS table_name, a.name AS area_name
      FROM orders o
      LEFT JOIN restaurant_tables t ON t.id = o.table_id
      LEFT JOIN areas a ON a.id = t.area_id
      WHERE o.status IN ('abierta', 'pagada')
        AND EXISTS (
          SELECT 1 FROM order_items oi
          WHERE oi.order_id = o.id AND oi.status IN ('sent', 'preparing', 'ready')
        )
      ORDER BY o.kitchen_sent_at ASC, o.id ASC
    `)
    .all();
  if (orders.length === 0) return [];
  const placeholders = orders.map(() => '?').join(',');
  const allItems = attachModifiers(
    db,
    db.prepare(`
      SELECT * FROM order_items
      WHERE order_id IN (${placeholders}) AND status IN ('sent', 'preparing', 'ready')
      ORDER BY order_id, sort_order, id
    `).all(...orders.map((order) => order.id)),
  );
  const byOrder = new Map();
  for (const item of allItems) {
    const orderId = Number(item.order_id);
    if (!byOrder.has(orderId)) byOrder.set(orderId, []);
    byOrder.get(orderId).push({
      id: Number(item.id),
      productName: item.product_name,
      quantity: Number(item.quantity),
      notes: item.notes,
      status: item.status,
      course: Number(item.course),
      sentAt: item.sent_at,
      sentQuantity: Number(item.sent_quantity ?? 0),
      readyAt: item.ready_at,
      modifiers: (item.modifiers ?? []).map((modifier) => ({
        name: modifier.modifier_name,
        groupName: modifier.group_name,
      })),
    });
  }
  return orders.map((order) => {
    const items = byOrder.get(Number(order.id)) ?? [];
    return {
      orderId: Number(order.id),
      orderNumber: order.order_number,
      type: order.type,
      serviceType: order.type === 'mesa' ? 'dine_in' : order.delivery ? 'delivery' : 'takeaway',
      tableName: order.table_name,
      areaName: order.area_name,
      source: order.source,
      delivery: Boolean(order.delivery),
      totalCents: Number(order.total_cents),
      amountPaidCents: Number(order.amount_paid_cents ?? 0),
      customerName: order.customer_name,
      notes: order.notes,
      sentAt: order.kitchen_sent_at,
      openedAt: order.created_at,
      status: order.status,
      items,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    };
  });
}

export function updateKitchenItem(db, itemId, status, staffId, now = new Date().toISOString()) {
  if (!ITEM_STATUSES.includes(status)) {
    throw validationError('Estado de cocina inválido.');
  }
  const item = db.prepare('SELECT * FROM order_items WHERE id = ?').get(itemId);
  if (!item) throw notFound('No se encontró el platillo.');
  const timestamp = now;
  const fields = ['status = ?'];
  const params = [status];
  if (status === 'preparing') {
    fields.push('ready_at = NULL', 'served_at = NULL');
  } else if (status === 'ready') {
    fields.push('ready_at = ?', 'served_at = NULL');
    params.push(timestamp);
  } else if (status === 'served') {
    fields.push('served_at = ?');
    params.push(timestamp);
  } else if (status === 'sent') {
    fields.push('ready_at = NULL', 'served_at = NULL');
  }
  params.push(itemId);
  db.prepare(`UPDATE order_items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  audit(db, staffId, `kitchen.item.${status}`, 'order_item', Number(itemId), {
    orderId: Number(item.order_id),
    productName: item.product_name,
  });
  return { orderId: Number(item.order_id), item: { id: Number(itemId), status } };
}

export function updateKitchenTicket(db, orderId, status, staffId, now = new Date().toISOString()) {
  if (!['preparing', 'ready', 'served'].includes(status)) {
    throw validationError('Estado de ticket inválido.');
  }
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId);
  if (!order) throw notFound('No se encontró el pedido.');
  let itemQuery;
  if (status === 'preparing') {
    itemQuery = "SELECT id, order_id, product_name FROM order_items WHERE order_id = ? AND status IN ('sent', 'preparing')";
  } else if (status === 'ready') {
    itemQuery = "SELECT id, order_id, product_name FROM order_items WHERE order_id = ? AND status IN ('sent', 'preparing', 'ready')";
  } else {
    itemQuery = "SELECT id, order_id, product_name FROM order_items WHERE order_id = ? AND status IN ('sent', 'preparing', 'ready')";
  }
  const items = db.prepare(itemQuery).all(orderId);
  if (items.length === 0) throw validationError('No hay platillos pendientes en este ticket.');
  transaction(db, () => {
    if (status === 'preparing') {
      db.prepare("UPDATE order_items SET status = 'preparing', ready_at = NULL, served_at = NULL WHERE order_id = ? AND status IN ('sent', 'preparing')").run(orderId);
    } else if (status === 'ready') {
      db.prepare("UPDATE order_items SET status = 'ready', ready_at = ?, served_at = NULL WHERE order_id = ? AND status IN ('sent', 'preparing', 'ready')").run(now, orderId);
    } else {
      db.prepare("UPDATE order_items SET status = 'served', served_at = ? WHERE order_id = ? AND status IN ('sent', 'preparing', 'ready')").run(now, orderId);
    }
    audit(db, staffId, `kitchen.ticket.${status}`, 'order', Number(orderId), { itemCount: items.length });
  });
  return getOrder(db, orderId);
}
