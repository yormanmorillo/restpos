import { randomBytes, randomUUID } from 'node:crypto';
import { calculateLineTotal, calculateTotals, calculateChange } from '@restpos/shared/pricing';
import { businessDateFor } from './business-date.js';
import { transaction } from './db.js';
import { conflict, notFound, unprocessable, validationError } from './errors.js';
import { serializeOrder, serializePayment } from './serializers.js';
import { resolveSelectedModifiers } from './modifiers.js';
import { requireOpenShiftForPayment } from './shifts.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { resolveActivePaymentMethod } from './payment-methods.js';
import { consumeInventoryForOrder } from './inventory.js';

const ORDER_SELECT = `
  SELECT o.*, t.name AS table_name, a.name AS area_name, a.id AS area_id
  FROM orders o
  LEFT JOIN restaurant_tables t ON t.id = o.table_id
  LEFT JOIN areas a ON a.id = t.area_id
`;

function isUniqueViolation(error) {
  return /UNIQUE constraint failed/i.test(error?.message ?? '');
}

function loadRawOrder(db, id) {
  const row = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
  if (!row) throw notFound('No se encontró el pedido.');
  return row;
}

function newReceiptToken() {
  return randomBytes(24).toString('base64url');
}

export function ensureReceiptToken(db, id, now = new Date().toISOString()) {
  const row = loadRawOrder(db, id);
  if (row.status !== 'pagada') {
    throw conflict('Solo puedes compartir la factura de un pedido pagado.');
  }
  if (!row.public_receipt_token) {
    db.prepare('UPDATE orders SET public_receipt_token = ?, updated_at = ? WHERE id = ?')
      .run(newReceiptToken(), now, id);
    audit(db, null, 'order.receipt_token', 'order', Number(id), {});
  }
  return getOrder(db, id);
}

function attachModifiers(db, items) {
  if (items.length === 0) return items;
  const placeholders = items.map(() => '?').join(',');
  const modifiers = db
    .prepare(`
      SELECT * FROM order_item_modifiers
      WHERE order_item_id IN (${placeholders})
      ORDER BY id
    `)
    .all(...items.map((item) => item.id));
  const byItem = new Map();
  for (const modifier of modifiers) {
    const itemId = Number(modifier.order_item_id);
    if (!byItem.has(itemId)) byItem.set(itemId, []);
    byItem.get(itemId).push(modifier);
  }
  return items.map((item) => ({ ...item, modifiers: byItem.get(Number(item.id)) ?? [] }));
}

function loadItems(db, orderId) {
  const items = db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id')
    .all(orderId);
  return attachModifiers(db, items);
}

function loadPayments(db, orderId) {
  const payments = db
    .prepare(`
      SELECT p.*, st.name AS staff_name,
             (SELECT COUNT(*) FROM payment_photos pp WHERE pp.payment_id = p.id) AS photo_count
      FROM payments p
      LEFT JOIN staff st ON st.id = p.staff_id
      WHERE p.order_id = ?
      ORDER BY p.created_at, p.id
    `)
    .all(orderId);
  if (payments.length === 0) return payments;
  const placeholders = payments.map(() => '?').join(',');
  const photos = db
    .prepare(`SELECT * FROM payment_photos WHERE payment_id IN (${placeholders}) ORDER BY id`)
    .all(...payments.map((payment) => payment.id));
  const byPayment = new Map();
  for (const photo of photos) {
    const paymentId = Number(photo.payment_id);
    if (!byPayment.has(paymentId)) byPayment.set(paymentId, []);
    byPayment.get(paymentId).push(photo);
  }
  return payments.map((payment) => ({ ...payment, photos: byPayment.get(Number(payment.id)) ?? [] }));
}

export function getOrder(db, id) {
  const row = loadRawOrder(db, id);
  const order = serializeOrder(row, loadItems(db, id));
  order.payments = loadPayments(db, id).map(serializePayment);
  return order;
}

function parseAdjustments(raw, input) {
  const discountType = input.discountType ?? raw.discount_type;
  const discountValue =
    input.discountValue !== undefined
      ? input.discountValue
      : input.discountType !== undefined
        ? 0
        : raw.discount_value;
  const tipType = input.tipType ?? raw.tip_type;
  const tipValue =
    input.tipValue !== undefined
      ? input.tipValue
      : input.tipType !== undefined
        ? 0
        : raw.tip_value;
  return {
    discountType,
    discountValue: discountType === 'none' ? 0 : discountValue,
    tipType,
    tipValue: tipType === 'none' ? 0 : tipValue,
  };
}

function safeTotals(input) {
  try {
    return calculateTotals(input);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      throw validationError(error.message);
    }
    throw error;
  }
}

function modifierIdsOf(row) {
  return row.modifiers
    .filter((modifier) => modifier.modifier_id !== null)
    .map((modifier) => Number(modifier.modifier_id))
    .sort((a, b) => a - b);
}

export function createOrder(db, config, input, { now = new Date(), staffId = null } = {}) {
  const timestamp = now.toISOString();
  let orderId;
  const deliveryFeeCents = input.delivery
    ? Number(getSetting(db, 'delivery_fee_cents', '0'))
    : 0;

  try {
    transaction(db, () => {
      if (input.type === 'mesa') {
        const table = db
          .prepare('SELECT id, name FROM restaurant_tables WHERE id = ? AND active = 1')
          .get(input.tableId);
        if (!table) throw notFound('No se encontró la mesa seleccionada.');
        const openOrder = db
          .prepare("SELECT id FROM orders WHERE table_id = ? AND status = 'abierta'")
          .get(input.tableId);
        if (openOrder) {
          throw conflict('Esta mesa ya tiene un pedido abierto.', { orderId: Number(openOrder.id) });
        }
        db.prepare("UPDATE restaurant_tables SET status = 'ocupada' WHERE id = ?").run(input.tableId);
      }

      const result = db
        .prepare(`
          INSERT INTO orders
            (order_number, type, table_id, status, customer_name, customer_phone, notes,
             delivery, delivery_address, source, scheduled_for, delivery_fee_cents, tax_rate_bps,
             business_date, opened_by_staff_id, created_at, updated_at)
          VALUES (?, ?, ?, 'abierta', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          `TMP-${randomUUID()}`,
          input.type,
          input.type === 'mesa' ? input.tableId : null,
          input.customerName ?? '',
          input.customerPhone ?? '',
          input.notes ?? '',
          input.delivery ? 1 : 0,
          input.deliveryAddress ?? '',
          input.source ?? 'pos',
          input.scheduledFor ?? null,
          deliveryFeeCents,
          config.taxRateBps,
          businessDateFor(now, config.timezone),
          staffId,
          timestamp,
          timestamp,
        );
      orderId = Number(result.lastInsertRowid);
      const orderNumber = `P-${String(orderId).padStart(5, '0')}`;
      db.prepare('UPDATE orders SET order_number = ? WHERE id = ?').run(orderNumber, orderId);
      audit(db, staffId, 'order.create', 'order', orderId, {
        type: input.type,
        delivery: Boolean(input.delivery),
        tableId: input.tableId ?? null,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('La mesa ya tiene un pedido abierto.');
    }
    throw error;
  }

  return getOrder(db, orderId);
}

export function updateOrderDraft(db, config, id, input, { now = new Date(), staffId = null } = {}) {
  const timestamp = now.toISOString();

  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') {
      throw conflict('Este pedido ya no se puede modificar.', { status: raw.status });
    }
    if (Number(raw.amount_paid_cents || 0) > 0) {
      throw conflict('Este pedido tiene pagos registrados y ya no se puede modificar.');
    }

    const existingItems = loadItems(db, id);
    const existingByKey = new Map(existingItems.map((item) => [item.client_key, item]));
    const existingProductIds = new Set(
      existingItems.filter((item) => item.product_id !== null).map((item) => Number(item.product_id)),
    );
    const sourceItems =
      input.items ??
      existingItems.map((item) => ({
        clientKey: item.client_key,
        productId: item.product_id,
        quantity: item.quantity,
        notes: item.notes,
        course: item.course,
        modifiers: modifierIdsOf(item),
      }));

    const productStatement = db.prepare(`
      SELECT p.*, c.active AS category_active
      FROM products p
      JOIN categories c ON c.id = p.category_id
      WHERE p.id = ?
    `);

    const normalizedItems = sourceItems.map((line) => {
      const existing = existingByKey.get(line.clientKey);
      if (existing) {
        if (Number(existing.product_id) !== line.productId) {
          throw validationError('No se puede cambiar el producto de una línea existente.', {
            fields: [{ path: 'items', message: `La línea ${line.clientKey} cambió de producto.` }],
          });
        }
        if (line.modifiers !== undefined) {
          const sent = [...new Set(line.modifiers.map(Number))].sort((a, b) => a - b);
          const current = modifierIdsOf(existing);
          if (JSON.stringify(sent) !== JSON.stringify(current)) {
            throw validationError(
              'Para cambiar los modificadores, elimina la línea y agrégala de nuevo.',
            );
          }
        }
        const notes = line.notes ?? '';
        const changed = Number(existing.quantity) !== line.quantity || existing.notes !== notes;
        return {
          ...existing,
          clientKey: existing.client_key,
          productId: Number(existing.product_id),
          productName: existing.product_name,
          unitPriceCents: Number(existing.unit_price_cents),
          quantity: line.quantity,
          notes,
          status: changed ? 'pending' : existing.status,
          sent_at: changed ? null : existing.sent_at,
          ready_at: changed ? null : existing.ready_at,
          served_at: changed ? null : existing.served_at,
          course: line.course ?? existing.course,
          modifiers: existing.modifiers,
          modifiersTotalCents: Number(existing.modifiers_total_cents ?? 0),
          lineTotalCents: calculateLineTotal(Number(existing.unit_price_cents), line.quantity),
        };
      }

      const product = productStatement.get(line.productId);
      if (!product) {
        throw validationError('Uno de los productos ya no existe.', {
          fields: [{ path: 'items', message: `Producto ${line.productId} no encontrado.` }],
        });
      }
      if ((!product.active || !product.category_active) && !existingProductIds.has(line.productId)) {
        throw unprocessable(`"${product.name}" no está disponible en este momento.`, {
          productId: Number(product.id),
        });
      }
      const selection = resolveSelectedModifiers(db, Number(product.id), line.modifiers ?? []);
      const unitPriceCents = Number(product.price_cents) + selection.modifiersTotalCents;
      return {
        ...line,
        productId: Number(product.id),
        productName: product.name,
        unitPriceCents,
        modifiers: selection.modifiers.map((modifier) => ({
          modifier_id: modifier.modifierId,
          group_name: modifier.groupName,
          modifier_name: modifier.modifierName,
          price_delta_cents: modifier.priceDeltaCents,
        })),
        modifiersTotalCents: selection.modifiersTotalCents,
        status: 'pending',
        sent_at: null,
        ready_at: null,
        served_at: null,
        course: line.course ?? 1,
        lineTotalCents: calculateLineTotal(unitPriceCents, line.quantity),
      };
    });

    const adjustments = parseAdjustments(raw, input);
    const totals = safeTotals({
      items: normalizedItems,
      discountType: adjustments.discountType,
      discountValue: adjustments.discountValue,
      tipType: adjustments.tipType,
      tipValue: adjustments.tipValue,
      taxRateBps: Number(raw.tax_rate_bps),
    });

    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
    const insertItem = db.prepare(`
      INSERT INTO order_items
        (order_id, client_key, product_id, product_name, unit_price_cents, quantity, notes,
         line_total_cents, status, course, sent_at, ready_at, served_at,
         modifiers_total_cents, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertModifier = db.prepare(`
      INSERT INTO order_item_modifiers
        (order_item_id, modifier_id, group_name, modifier_name, price_delta_cents)
      VALUES (?, ?, ?, ?, ?)
    `);
    normalizedItems.forEach((item, index) => {
      const result = insertItem.run(
        id,
        item.clientKey,
        item.productId,
        item.productName,
        item.unitPriceCents,
        item.quantity,
        item.notes,
        item.lineTotalCents,
        item.status,
        item.course,
        item.sent_at,
        item.ready_at,
        item.served_at,
        item.modifiersTotalCents,
        index,
      );
      const itemId = Number(result.lastInsertRowid);
      for (const modifier of item.modifiers) {
        insertModifier.run(
          itemId,
          modifier.modifier_id ?? null,
          modifier.group_name,
          modifier.modifier_name,
          modifier.price_delta_cents,
        );
      }
    });

    db.prepare(`
      UPDATE orders SET
        customer_name = ?, customer_phone = ?, notes = ?,
        delivery = ?, delivery_address = ?, scheduled_for = ?,
        subtotal_cents = ?, discount_type = ?, discount_value = ?, discount_cents = ?,
        tax_cents = ?, tip_type = ?, tip_value = ?, tip_cents = ?, total_cents = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.customerName !== undefined ? input.customerName : raw.customer_name,
      input.customerPhone !== undefined ? input.customerPhone : raw.customer_phone,
      input.notes !== undefined ? input.notes : raw.notes,
      input.delivery !== undefined ? (input.delivery ? 1 : 0) : raw.delivery,
      input.deliveryAddress !== undefined ? input.deliveryAddress : raw.delivery_address,
      input.scheduledFor !== undefined ? input.scheduledFor : raw.scheduled_for,
      totals.subtotalCents,
      adjustments.discountType,
      adjustments.discountValue,
      totals.discountCents,
      totals.taxCents,
      adjustments.tipType,
      adjustments.tipValue,
      totals.tipCents,
      totals.totalCents + Number(raw.delivery_fee_cents || 0),
      timestamp,
      id,
    );
    audit(db, staffId, 'order.update', 'order', id, {
      itemCount: normalizedItems.length,
      totalCents: totals.totalCents + Number(raw.delivery_fee_cents || 0),
    });
  });

  return getOrder(db, id);
}

export function sendOrderToKitchen(db, id, { now = new Date(), staffId = null } = {}) {
  const timestamp = now.toISOString();
  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') throw conflict('Este pedido ya está cerrado.');
    const pending = db
      .prepare("SELECT * FROM order_items WHERE order_id = ? AND status = 'pending' ORDER BY sort_order, id")
      .all(id);
    if (pending.length === 0) {
      throw unprocessable('No hay productos nuevos por enviar a cocina.');
    }
    db.prepare(`
      UPDATE order_items SET status = 'sent', sent_at = ?
      WHERE order_id = ? AND status = 'pending'
    `).run(timestamp, id);
    db.prepare('UPDATE orders SET kitchen_sent_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, id);
    audit(db, staffId, 'order.send_kitchen', 'order', id, { itemCount: pending.length });
  });
  return getOrder(db, id);
}

export function payOrder(db, config, id, input, { now = new Date(), staffId = null } = {}) {
  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') {
      throw conflict('Este pedido ya fue cerrado.', { status: raw.status });
    }
    const items = loadItems(db, id);
    if (items.length === 0) {
      throw unprocessable('Agrega al menos un producto antes de cobrar.');
    }

    const baseTotals = safeTotals({
      items: items.map((item) => ({
        unitPriceCents: Number(item.unit_price_cents),
        quantity: Number(item.quantity),
      })),
      discountType: raw.discount_type,
      discountValue: Number(raw.discount_value),
      tipType: raw.tip_type,
      tipValue: Number(raw.tip_value),
      taxRateBps: Number(raw.tax_rate_bps),
    });
    const deliveryFeeCents = Number(raw.delivery_fee_cents || 0);
    const totals = {
      ...baseTotals,
      totalCents: baseTotals.totalCents + deliveryFeeCents,
    };
    if (totals.totalCents < Number(raw.amount_paid_cents || 0)) {
      throw conflict('El total actual es menor a lo ya pagado.');
    }

    const paymentMethod = resolveActivePaymentMethod(db, input.paymentMethod);
    const shift = requireOpenShiftForPayment(db);
    const alreadyPaid = Number(raw.amount_paid_cents || 0);
    const balance = totals.totalCents - alreadyPaid;
    if (balance <= 0) {
      throw conflict('Este pedido no tiene saldo pendiente.');
    }
    const amountCents = input.amountCents ?? balance;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      throw validationError('El monto del pago debe ser un entero positivo.');
    }
    if (amountCents > balance) {
      throw validationError('El pago no puede superar el saldo pendiente.');
    }

    let cashReceivedCents = null;
    let changeCents = 0;
    if (paymentMethod.kind === 'cash') {
      cashReceivedCents = input.cashReceivedCents ?? amountCents;
      if (!Number.isInteger(cashReceivedCents) || cashReceivedCents < amountCents) {
        throw unprocessable('El efectivo recibido no cubre el monto del pago.', {
          amountCents,
          cashReceivedCents,
          missingCents: amountCents - (cashReceivedCents || 0),
        });
      }
      changeCents = calculateChange(amountCents, cashReceivedCents);
    }

    const timestamp = now.toISOString();
    db.prepare(`
      INSERT INTO payments
        (order_id, shift_id, staff_id, payment_method, method_name, method_kind,
         amount_cents, cash_received_cents, change_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      shift?.id ?? null,
      staffId,
      paymentMethod.code,
      paymentMethod.name,
      paymentMethod.kind,
      amountCents,
      cashReceivedCents,
      changeCents,
      timestamp,
    );

    const newPaid = alreadyPaid + amountCents;
    const closesOrder = newPaid >= totals.totalCents;
    const cashTotals = db.prepare(`
      SELECT COALESCE(SUM(cash_received_cents), 0) AS cash_received,
             COALESCE(SUM(change_cents), 0) AS change_total
      FROM payments WHERE order_id = ?
    `).get(id);

    db.prepare(`
      UPDATE orders SET
        amount_paid_cents = ?,
        subtotal_cents = ?, discount_cents = ?, tax_cents = ?, tip_cents = ?, total_cents = ?,
        payment_method = ?,
        payment_method_name = ?,
        cash_received_cents = ?,
        change_cents = ?,
        business_date = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      newPaid,
      totals.subtotalCents,
      totals.discountCents,
      totals.taxCents,
      totals.tipCents,
      totals.totalCents,
      paymentMethod.code,
      paymentMethod.name,
      Number(cashTotals.cash_received) > 0 ? Number(cashTotals.cash_received) : null,
      cashTotals.change_total,
      businessDateFor(now, config.timezone),
      timestamp,
      id,
    );

    if (closesOrder) {
      db.prepare(`
        UPDATE orders SET
          status = 'pagada',
          paid_at = ?,
          closed_by_staff_id = ?,
          shift_id = ?,
          public_receipt_token = COALESCE(public_receipt_token, ?),
          updated_at = ?
        WHERE id = ?
      `).run(timestamp, staffId, shift?.id ?? null, newReceiptToken(), timestamp, id);
      if (raw.table_id !== null) {
        db.prepare("UPDATE restaurant_tables SET status = 'libre' WHERE id = ?").run(raw.table_id);
      }
      consumeInventoryForOrder(db, id, staffId, timestamp);
    }

    audit(db, staffId, closesOrder ? 'order.pay' : 'order.partial_payment', 'order', id, {
      amountCents,
      paymentMethod: paymentMethod.code,
      paymentMethodName: paymentMethod.name,
      newPaid,
      totalCents: totals.totalCents,
      shiftId: shift?.id ?? null,
    });
  });

  return getOrder(db, id);
}

export function cancelOrder(db, id, { now = new Date(), staffId = null } = {}) {
  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') {
      throw conflict('Solo se pueden anular pedidos abiertos.', { status: raw.status });
    }
    if (Number(raw.amount_paid_cents || 0) > 0) {
      throw conflict('No se puede anular un pedido con pagos registrados.');
    }
    const timestamp = now.toISOString();
    db.prepare(`
      UPDATE orders SET status = 'anulada', cancelled_at = ?, updated_at = ? WHERE id = ?
    `).run(timestamp, timestamp, id);
    if (raw.table_id !== null) {
      db.prepare("UPDATE restaurant_tables SET status = 'libre' WHERE id = ?").run(raw.table_id);
    }
    audit(db, staffId, 'order.cancel', 'order', id, {});
  });
  return getOrder(db, id);
}

export function listOrders(db, { status, type, date, limit = 50, offset = 0, source } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('o.status = ?');
    params.push(status);
  }
  if (type) {
    clauses.push('o.type = ?');
    params.push(type);
  }
  if (source) {
    clauses.push('o.source = ?');
    params.push(source);
  }
  if (date) {
    clauses.push('o.business_date = ?');
    params.push(date);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = Number(
    db.prepare(`SELECT COUNT(*) AS count FROM orders o ${where}`).get(...params).count,
  );
  const rows = db
    .prepare(`
      SELECT o.*, t.name AS table_name, a.name AS area_name, a.id AS area_id,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o
      LEFT JOIN restaurant_tables t ON t.id = o.table_id
      LEFT JOIN areas a ON a.id = t.area_id
      ${where}
      ORDER BY COALESCE(o.paid_at, o.created_at) DESC, o.id DESC
      LIMIT ? OFFSET ?
    `)
    .all(...params, limit, offset);

  return {
    orders: rows.map((row) => serializeOrder(row)),
    total,
    limit,
    offset,
  };
}

export function listTables(db) {
  const rows = db
    .prepare(`
      SELECT
        t.id, t.name, t.capacity, t.status, t.position, t.active,
        a.id AS area_id, a.name AS area_name,
        o.id AS open_order_id,
        o.order_number AS open_order_number,
        o.total_cents AS open_order_total_cents,
        o.amount_paid_cents AS open_order_paid_cents,
        o.customer_name AS open_order_customer_name,
        o.created_at AS open_order_created_at,
        o.delivery AS open_order_delivery,
        o.source AS open_order_source,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS open_order_item_count,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status = 'pending') AS open_order_pending_count,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.status IN ('sent', 'preparing')) AS open_order_kitchen_count
      FROM restaurant_tables t
      LEFT JOIN areas a ON a.id = t.area_id
      LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'abierta'
      WHERE t.active = 1
      ORDER BY a.sort_order, t.position, t.id
    `)
    .all();
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    capacity: Number(row.capacity),
    status: row.open_order_id ? 'ocupada' : 'libre',
    areaId: row.area_id === null ? null : Number(row.area_id),
    areaName: row.area_name ?? 'Sin área',
    position: Number(row.position),
    openOrder: row.open_order_id
      ? {
          id: Number(row.open_order_id),
          orderNumber: row.open_order_number,
          totalCents: Number(row.open_order_total_cents),
          amountPaidCents: Number(row.open_order_paid_cents),
          itemCount: Number(row.open_order_item_count),
          pendingCount: Number(row.open_order_pending_count),
          kitchenCount: Number(row.open_order_kitchen_count),
          customerName: row.open_order_customer_name,
          delivery: Boolean(row.open_order_delivery),
          source: row.open_order_source,
          openedAt: row.open_order_created_at,
        }
      : null,
  }));
}
