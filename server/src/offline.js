import { randomBytes } from 'node:crypto';
import { calculateLineTotal, calculateTotals, calculateChange } from '@restpos/shared/pricing';
import { businessDateFor } from './business-date.js';
import { conflict, validationError } from './errors.js';
import { transaction } from './db.js';
import { audit } from './audit.js';
import { getBooleanSetting } from './settings.js';
import { getOpenShift } from './shifts.js';
import { consumeInventoryForOrder } from './inventory.js';
import { getOrder } from './orders.js';

function receiptToken() {
  return randomBytes(24).toString('base64url');
}

export function createOfflineSale(db, config, input, staffId, now = new Date()) {
  const existing = db.prepare('SELECT id FROM orders WHERE client_operation_id = ?').get(input.operationId);
  if (existing) return getOrder(db, Number(existing.id));

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;
  if (!Number.isFinite(occurredAt.getTime())) throw validationError('La fecha de la venta offline no es válida.');
  if (occurredAt.getTime() > now.getTime() + 5 * 60 * 1000) throw validationError('La fecha de la venta offline no puede estar en el futuro.');
  if (now.getTime() - occurredAt.getTime() > 7 * 24 * 60 * 60 * 1000) throw validationError('La venta offline es demasiado antigua para sincronizarse.');

  const shift = getOpenShift(db);
  if (getBooleanSetting(db, 'require_shift', true) && !shift) {
    throw conflict('Abre un turno de caja antes de sincronizar ventas offline.');
  }

  const products = new Map();
  for (const item of input.items) {
    const product = db.prepare(`
      SELECT p.*, c.active AS category_active
      FROM products p JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
    `).get(item.productId);
    if (!product || !product.active || !product.category_active) {
      throw validationError(`El producto ${item.productId} ya no está disponible.`);
    }
    products.set(Number(item.productId), product);
  }

  const items = input.items.map((item, index) => {
    const product = products.get(Number(item.productId));
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw validationError('Cantidad inválida en una venta offline.');
    return {
      productId: Number(product.id),
      productName: product.name,
      unitPriceCents: Number(product.price_cents),
      quantity,
      notes: String(item.notes ?? '').slice(0, 200),
      lineTotalCents: calculateLineTotal(Number(product.price_cents), quantity),
      sortOrder: index,
    };
  });
  const totals = calculateTotals({
    items,
    taxRateBps: Number(config.taxRateBps),
    discountType: 'none',
    tipType: 'none',
  });
  if (!Number.isInteger(input.cashReceivedCents) || input.cashReceivedCents < totals.totalCents) {
    throw validationError('El efectivo recibido no cubre el total de la venta offline.');
  }
  const changeCents = calculateChange(totals.totalCents, input.cashReceivedCents);
  const timestamp = occurredAt.toISOString();
  let orderId;

  transaction(db, () => {
    const result = db.prepare(`
      INSERT INTO orders
        (order_number, type, table_id, status, customer_name, customer_phone, notes,
         delivery, delivery_address, source, scheduled_for, delivery_fee_cents, tax_rate_bps,
         business_date, opened_by_staff_id, client_operation_id, created_at, updated_at)
      VALUES (?, 'llevar', NULL, 'pagada', ?, '', '', 0, '', 'offline', NULL, 0, ?, ?, ?, ?, ?, ?)
    `).run(
      `TMP-${input.operationId}`,
      input.customerName ?? '',
      Number(config.taxRateBps),
      businessDateFor(occurredAt, config.timezone),
      staffId,
      input.operationId,
      timestamp,
      timestamp,
    );
    orderId = Number(result.lastInsertRowid);
    db.prepare('UPDATE orders SET order_number = ? WHERE id = ?').run(`P-${String(orderId).padStart(5, '0')}`, orderId);
    const insertItem = db.prepare(`
      INSERT INTO order_items
        (order_id, client_key, product_id, product_name, unit_price_cents, quantity, notes,
         line_total_cents, status, course, sent_at, sent_quantity, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', 1, ?, ?, ?)
    `);
    items.forEach((item, index) => {
      insertItem.run(orderId, `offline-${input.operationId}-${index}`, item.productId, item.productName, item.unitPriceCents, item.quantity, item.notes, item.lineTotalCents, timestamp, item.quantity, index);
    });
    db.prepare(`
      INSERT INTO payments
        (order_id, shift_id, staff_id, payment_method, method_name, method_kind, amount_cents,
         cash_received_cents, change_cents, created_at)
      VALUES (?, ?, ?, 'efectivo', 'Efectivo', 'cash', ?, ?, ?, ?)
    `).run(orderId, shift?.id ?? null, staffId, totals.totalCents, input.cashReceivedCents, changeCents, timestamp);
    db.prepare(`
      UPDATE orders SET
        subtotal_cents = ?, tax_cents = ?, tip_cents = 0, total_cents = ?, amount_paid_cents = ?,
        payment_method = 'efectivo', payment_method_name = 'Efectivo',
        cash_received_cents = ?, change_cents = ?, paid_at = ?, closed_by_staff_id = ?,
        shift_id = ?, public_receipt_token = ?, kitchen_sent_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      totals.subtotalCents, totals.taxCents, totals.totalCents, totals.totalCents,
      input.cashReceivedCents, changeCents, timestamp, staffId, shift?.id ?? null,
      receiptToken(), timestamp, timestamp, orderId,
    );
    consumeInventoryForOrder(db, orderId, staffId, timestamp);
    audit(db, staffId, 'order.offline_sale', 'order', orderId, {
      operationId: input.operationId,
      totalCents: totals.totalCents,
      cashReceivedCents: input.cashReceivedCents,
      itemCount: items.length,
    });
  });

  return getOrder(db, orderId);
}
