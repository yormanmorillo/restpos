import { randomBytes, randomUUID } from 'node:crypto';
import { calculateLineTotal, calculateTotals, calculateChange } from '@restpos/shared/pricing';
import { businessDateFor } from './business-date.js';
import { transaction } from './db.js';
import { AppError, conflict, notFound, unprocessable, validationError } from './errors.js';
import { serializeOrder, serializePayment } from './serializers.js';
import { resolveSelectedModifiers } from './modifiers.js';
import { requireOpenShiftForPayment } from './shifts.js';
import { audit } from './audit.js';
import { getSetting } from './settings.js';
import { resolveActivePaymentMethod } from './payment-methods.js';
import { consumeInventoryForOrder, productStockAvailability } from './inventory.js';
import { featureEnabled } from './features.js';
import { awardLoyaltyForOrder, reverseLoyaltyForOrder } from './customers.js';
import { findActiveHappyHour } from './promotions.js';
import { redeemGiftCard } from './gift-cards.js';
import { listOrderSplits } from './splits.js';

const MAX_DISCOUNT_BPS = { server: 1000, cashier: 1000, manager: 2500, admin: 10000, owner: 10000 };

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
  order.splits = listOrderSplits(db, id);
  if (order.customerId) {
    const customer = db.prepare('SELECT id, name, phone, points_balance FROM customers WHERE id = ?').get(order.customerId);
    order.customer = customer ? { id: Number(customer.id), name: customer.name, phone: customer.phone, pointsBalance: Number(customer.points_balance) } : null;
  } else {
    order.customer = null;
  }
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
    discountReason: discountType === 'none' ? '' : (input.discountReason ?? raw.discount_reason ?? ''),
    tipType,
    tipValue: tipType === 'none' ? 0 : tipValue,
  };
}

function assertDiscountAllowed(rawItems, adjustments, staffRole) {
  if (adjustments.discountType === 'none' || adjustments.discountValue <= 0) {
    return;
  }
  const reason = String(adjustments.discountReason ?? '').trim();
  if (reason.length < 3) {
    throw validationError('Indica el motivo del descuento.');
  }
  const maxBps = MAX_DISCOUNT_BPS[staffRole] ?? MAX_DISCOUNT_BPS.server;
  const subtotalCents = rawItems.reduce(
    (sum, item) => sum + Number(item.unitPriceCents) * Number(item.quantity),
    0,
  );
  if (adjustments.discountType === 'percent' && adjustments.discountValue > maxBps) {
    throw new AppError(403, 'DISCOUNT_LIMIT', `Tu rol permite un descuento máximo de ${maxBps / 100}%.`);
  }
  if (adjustments.discountType === 'fixed') {
    const maxCents = Math.floor((subtotalCents * maxBps) / 10000);
    if (adjustments.discountValue > maxCents) {
      throw new AppError(403, 'DISCOUNT_LIMIT', `Tu rol permite un descuento máximo de ${maxBps / 100}% del subtotal.`);
    }
  }
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
  if (input.customerId && !db.prepare('SELECT id FROM customers WHERE id = ? AND active = 1').get(input.customerId)) {
    throw validationError('El cliente seleccionado no está disponible.');
  }
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
            (order_number, type, table_id, status, customer_id, customer_name, customer_phone, notes,
             delivery, delivery_address, source, scheduled_for, delivery_fee_cents, tax_rate_bps,
             business_date, opened_by_staff_id, created_at, updated_at)
          VALUES (?, ?, ?, 'abierta', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          `TMP-${randomUUID()}`,
          input.type,
          input.type === 'mesa' ? input.tableId : null,
          input.customerId ?? null,
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

export function updateOrderDraft(db, config, id, input, { now = new Date(), staffId = null, staffRole = 'admin' } = {}) {
  const timestamp = now.toISOString();

  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') {
      throw conflict('Este pedido ya no se puede modificar.', { status: raw.status });
    }
    if (Number(raw.amount_paid_cents || 0) > 0) {
      throw conflict('Este pedido tiene pagos registrados y ya no se puede modificar.');
    }
    if (input.delivery === true && raw.type !== 'llevar') {
      throw validationError('Solo un pedido para llevar puede marcarse como delivery.');
    }
    if (input.customerId && !db.prepare('SELECT id FROM customers WHERE id = ? AND active = 1').get(input.customerId)) {
      throw validationError('El cliente seleccionado no está disponible.');
    }
    if (db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(id).count > 0) {
      throw conflict('No se puede modificar un pedido con la cuenta dividida.');
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
        const notesChanged = existing.notes !== notes;
        const storedSent = Number(existing.sent_quantity ?? 0);
        const previousSent = existing.status === 'pending'
          ? 0
          : (storedSent > 0 ? storedSent : Number(existing.quantity));
        const status = notesChanged ? 'pending' : existing.status;
        const sentQuantity = notesChanged
          ? 0
          : Math.max(0, Math.min(previousSent, line.quantity));
        return {
          ...existing,
          id: Number(existing.id),
          isNew: false,
          clientKey: existing.client_key,
          productId: Number(existing.product_id),
          productName: existing.product_name,
          unitPriceCents: Number(existing.unit_price_cents),
          quantity: line.quantity,
          notes,
          status,
          sentQuantity,
          sent_at: notesChanged ? null : existing.sent_at,
          ready_at: notesChanged ? null : existing.ready_at,
          served_at: notesChanged ? null : existing.served_at,
          course: line.course ?? existing.course,
          stationId: existing.station_id ?? null,
          prepSeconds: Number(existing.prep_seconds ?? 0),
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
      if (!existingProductIds.has(line.productId) && featureEnabled(db, 'inventory_sold_out')) {
        const availability = productStockAvailability(db, [Number(product.id)]).get(Number(product.id));
        if (availability?.soldOut) {
          throw unprocessable(`"${product.name}" está agotado por inventario.`, { productId: Number(product.id) });
        }
      }
      const selection = resolveSelectedModifiers(db, Number(product.id), line.modifiers ?? []);
      const unitPriceCents = Number(product.price_cents) + selection.modifiersTotalCents;
      return {
        ...line,
        id: null,
        isNew: true,
        sentQuantity: 0,
        productId: Number(product.id),
        productName: product.name,
        unitPriceCents,
        stationId: product.station_id ?? db.prepare("SELECT id FROM kitchen_stations WHERE active = 1 ORDER BY sort_order, id LIMIT 1").get()?.id ?? null,
        prepSeconds: Number(product.prep_seconds ?? 0),
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
    assertDiscountAllowed(normalizedItems, adjustments, staffRole);
    let promotionId = raw.promotion_id ?? null;
    let promotionCode = raw.promotion_code ?? '';
    let appliedHappyHour = false;
    if (!raw.promotion_id && adjustments.discountType === 'none' && featureEnabled(db, 'happy_hour')) {
      const happyHour = findActiveHappyHour(db, now);
      if (happyHour) {
        adjustments.discountType = happyHour.type;
        adjustments.discountValue = happyHour.value;
        adjustments.discountReason = `Happy hour ${happyHour.code}`;
        promotionId = happyHour.id;
        promotionCode = happyHour.code;
        appliedHappyHour = true;
      }
    }
    const delivery = raw.type === 'llevar'
      ? (input.delivery !== undefined ? Boolean(input.delivery) : Boolean(raw.delivery))
      : false;
    const deliveryFeeCents = delivery ? Number(getSetting(db, 'delivery_fee_cents', '0')) : 0;
    const totals = safeTotals({
      items: normalizedItems,
      discountType: adjustments.discountType,
      discountValue: adjustments.discountValue,
      tipType: adjustments.tipType,
      tipValue: adjustments.tipValue,
      taxRateBps: Number(raw.tax_rate_bps),
    });

    const keptIds = normalizedItems.filter((item) => !item.isNew).map((item) => item.id);
    if (keptIds.length === 0) {
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
    } else {
      db.prepare(`DELETE FROM order_items WHERE order_id = ? AND id NOT IN (${keptIds.map(() => '?').join(',')})`)
        .run(id, ...keptIds);
    }
    const updateItem = db.prepare(`
      UPDATE order_items SET
        product_id = ?, product_name = ?, unit_price_cents = ?, quantity = ?, notes = ?,
        line_total_cents = ?, status = ?, course = ?, sent_at = ?, ready_at = ?, served_at = ?,
        modifiers_total_cents = ?, sort_order = ?, sent_quantity = ?, station_id = ?, prep_seconds = ?
      WHERE id = ? AND order_id = ?
    `);
    const insertItem = db.prepare(`
      INSERT INTO order_items
        (order_id, client_key, product_id, product_name, unit_price_cents, quantity, notes,
         line_total_cents, status, course, sent_at, ready_at, served_at,
         modifiers_total_cents, sort_order, sent_quantity, station_id, prep_seconds)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertModifier = db.prepare(`
      INSERT INTO order_item_modifiers
        (order_item_id, modifier_id, group_name, modifier_name, price_delta_cents)
      VALUES (?, ?, ?, ?, ?)
    `);
    normalizedItems.forEach((item, index) => {
      if (!item.isNew) {
        updateItem.run(
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
          item.sentQuantity,
          item.stationId ?? null,
          item.prepSeconds ?? 0,
          item.id,
          id,
        );
        return;
      }
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
        0,
        item.stationId ?? null,
        item.prepSeconds ?? 0,
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
        customer_id = ?, customer_name = ?, customer_phone = ?, notes = ?,
        delivery = ?, delivery_address = ?, scheduled_for = ?, delivery_fee_cents = ?,
        subtotal_cents = ?, discount_type = ?, discount_value = ?, discount_cents = ?, discount_reason = ?,
        promotion_id = ?, promotion_code = ?,
        tax_cents = ?, tip_type = ?, tip_value = ?, tip_cents = ?, total_cents = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.customerId !== undefined ? input.customerId : raw.customer_id,
      input.customerName !== undefined ? input.customerName : raw.customer_name,
      input.customerPhone !== undefined ? input.customerPhone : raw.customer_phone,
      input.notes !== undefined ? input.notes : raw.notes,
      delivery ? 1 : 0,
      input.deliveryAddress !== undefined ? input.deliveryAddress : raw.delivery_address,
      input.scheduledFor !== undefined ? input.scheduledFor : raw.scheduled_for,
      deliveryFeeCents,
      totals.subtotalCents,
      adjustments.discountType,
      adjustments.discountValue,
      totals.discountCents,
      adjustments.discountReason,
      promotionId,
      promotionCode,
      totals.taxCents,
      adjustments.tipType,
      adjustments.tipValue,
      totals.tipCents,
      totals.totalCents + deliveryFeeCents,
      timestamp,
      id,
    );
    if (appliedHappyHour && promotionId) {
      db.prepare('UPDATE promotions SET uses = uses + 1 WHERE id = ?').run(promotionId);
    }
    audit(db, staffId, 'order.update', 'order', id, {
      itemCount: normalizedItems.length,
      discountType: adjustments.discountType,
      discountValue: adjustments.discountValue,
      discountCents: totals.discountCents,
      discountReason: adjustments.discountReason,
      tipCents: totals.tipCents,
      totalCents: totals.totalCents + deliveryFeeCents,
      deliveryFeeCents,
    });
  });

  return getOrder(db, id);
}

export function sendOrderToKitchen(db, id, { now = new Date(), staffId = null } = {}) {
  const timestamp = now.toISOString();
  let kitchenSnapshot = null;
  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') throw conflict('Este pedido ya está cerrado.');
    kitchenSnapshot = getOrder(db, id);
    const items = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id')
      .all(id);
    const pending = items.filter((item) => {
      const sent = item.status === 'pending' ? 0 : Number(item.sent_quantity ?? 0);
      return item.status === 'pending' || sent < Number(item.quantity);
    });
    if (pending.length === 0) {
      throw unprocessable('No hay productos nuevos por enviar a cocina.');
    }
    let itemCount = 0;
    for (const item of pending) {
      const sent = item.status === 'pending' ? 0 : Number(item.sent_quantity ?? 0);
      const delta = item.status === 'pending' ? Number(item.quantity) : Number(item.quantity) - sent;
      itemCount += delta;
      db.prepare(`
        UPDATE order_items SET status = 'sent', sent_quantity = ?, sent_at = ?,
          ready_at = NULL, served_at = NULL
        WHERE id = ?
      `).run(Number(item.quantity), timestamp, item.id);
    }
    db.prepare('UPDATE orders SET kitchen_sent_at = ?, updated_at = ? WHERE id = ?')
      .run(timestamp, timestamp, id);
    audit(db, staffId, 'order.send_kitchen', 'order', id, { itemCount });
  });
  return { order: getOrder(db, id), kitchenSnapshot };
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
    if (paymentMethod.code === 'gift_card' && !featureEnabled(db, 'gift_cards')) {
      throw conflict('Las gift cards no están activas.');
    }
    const shift = requireOpenShiftForPayment(db);
    const alreadyPaid = Number(raw.amount_paid_cents || 0);
    const splits = db.prepare('SELECT * FROM order_splits WHERE order_id = ? ORDER BY id').all(id);
    let split = null;
    let balance;
    if (splits.length > 0) {
      if (!input.splitId) throw conflict('Selecciona la parte de la cuenta que vas a cobrar.');
      split = splits.find((entry) => Number(entry.id) === Number(input.splitId));
      if (!split) throw notFound('No se encontró esa parte de la cuenta.');
      if (split.status === 'paid') throw conflict('Esta parte de la cuenta ya fue pagada.');
      balance = Number(split.total_cents) - Number(split.amount_paid_cents);
    } else {
      if (input.splitId) throw validationError('Este pedido no está dividido.');
      balance = totals.totalCents - alreadyPaid;
    }
    if (balance <= 0) throw conflict('Este pedido no tiene saldo pendiente.');
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
    const giftCardCode = paymentMethod.code === 'gift_card' ? String(input.giftCardCode ?? '').trim() : null;
    let pointsRedeemed = 0;
    if (paymentMethod.code === 'puntos') {
      if (!featureEnabled(db, 'loyalty_redemption')) throw conflict('El canje de puntos no está activo.');
      const customer = raw.customer_id ? db.prepare('SELECT * FROM customers WHERE id = ?').get(raw.customer_id) : null;
      if (!customer) throw validationError('Selecciona un cliente para usar puntos.');
      const pointValue = Math.max(1, Number(getSetting(db, 'loyalty_point_value_cents', '10')) || 10);
      if (amountCents % pointValue !== 0) throw validationError(`El monto con puntos debe ser múltiplo de ${pointValue} centavos.`);
      pointsRedeemed = amountCents / pointValue;
      if (pointsRedeemed > Number(customer.points_balance)) throw conflict('El cliente no tiene suficientes puntos.');
      db.prepare('UPDATE customers SET points_balance = points_balance - ?, updated_at = ? WHERE id = ?').run(pointsRedeemed, timestamp, customer.id);
    }
    if (paymentMethod.code === 'gift_card') {
      if (!giftCardCode) throw validationError('Ingresa el código de la gift card.');
      redeemGiftCard(db, giftCardCode, amountCents, timestamp);
    }
    db.prepare(`
      INSERT INTO payments
        (order_id, shift_id, staff_id, payment_method, method_name, method_kind, split_id, gift_card_code, points_redeemed,
         amount_cents, cash_received_cents, change_cents, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      shift?.id ?? null,
      staffId,
      paymentMethod.code,
      paymentMethod.name,
      paymentMethod.kind,
      split?.id ?? null,
      giftCardCode,
      pointsRedeemed,
      amountCents,
      cashReceivedCents,
      changeCents,
      timestamp,
    );

    const newPaid = alreadyPaid + amountCents;
    if (split) {
      const splitPaid = Number(split.amount_paid_cents) + amountCents;
      db.prepare("UPDATE order_splits SET amount_paid_cents = ?, status = ?, paid_at = ? WHERE id = ?")
        .run(splitPaid, splitPaid >= Number(split.total_cents) ? 'paid' : 'open', splitPaid >= Number(split.total_cents) ? timestamp : null, split.id);
    }
    const openSplits = splits.length > 0
      ? db.prepare("SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ? AND status = 'open'").get(id).count
      : 0;
    const closesOrder = splits.length > 0
      ? Number(openSplits) === 0 && newPaid >= totals.totalCents
      : newPaid >= totals.totalCents;
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

    if (pointsRedeemed > 0) {
      db.prepare('UPDATE orders SET loyalty_points_redeemed = loyalty_points_redeemed + ? WHERE id = ?').run(pointsRedeemed, id);
    }
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
      awardLoyaltyForOrder(db, id, timestamp);
    }

    audit(db, staffId, closesOrder ? 'order.pay' : 'order.partial_payment', 'order', id, {
      amountCents,
      paymentMethod: paymentMethod.code,
      paymentMethodName: paymentMethod.name,
      newPaid,
      totalCents: totals.totalCents,
      subtotalCents: totals.subtotalCents,
      discountType: raw.discount_type,
      discountValue: Number(raw.discount_value),
      discountCents: totals.discountCents,
      discountReason: raw.discount_reason ?? '',
      tipCents: totals.tipCents,
      shiftId: shift?.id ?? null,
      splitId: split?.id ?? null,
    });
  });

  return getOrder(db, id);
}

export function closeCourtesyOrder(db, config, id, { reason, now = new Date(), staffId = null } = {}) {
  const cleanReason = String(reason ?? '').trim();
  if (cleanReason.length < 3) throw validationError('Indica el motivo de la cortesía.');
  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') throw conflict('Este pedido ya fue cerrado.', { status: raw.status });
    if (Number(raw.amount_paid_cents || 0) > 0) {
      throw conflict('Este pedido tiene pagos registrados; no se puede cerrar como cortesía.');
    }
    if (db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(id).count > 0) {
      throw conflict('Cierra las partes de la cuenta antes de registrar una cortesía.');
    }
    const items = loadItems(db, id);
    if (items.length === 0) throw unprocessable('Agrega al menos un producto antes de cerrar la cortesía.');
    const totals = safeTotals({
      items: items.map((item) => ({ unitPriceCents: Number(item.unit_price_cents), quantity: Number(item.quantity) })),
      discountType: raw.discount_type,
      discountValue: Number(raw.discount_value),
      tipType: raw.tip_type,
      tipValue: Number(raw.tip_value),
      taxRateBps: Number(raw.tax_rate_bps),
    });
    const totalCents = totals.totalCents + Number(raw.delivery_fee_cents || 0);
    if (totalCents !== 0) {
      throw conflict('La cortesía solo aplica cuando el total es cero. Aplica un descuento del 100%.');
    }
    const timestamp = now.toISOString();
    db.prepare(`
      UPDATE orders SET
        status = 'pagada', amount_paid_cents = 0, subtotal_cents = ?, discount_cents = ?,
        tax_cents = ?, tip_cents = ?, total_cents = 0,
        payment_method = 'cortesia', payment_method_name = 'Cortesía',
        paid_at = ?, closed_by_staff_id = ?, public_receipt_token = COALESCE(public_receipt_token, ?),
        business_date = ?, updated_at = ?
      WHERE id = ?
    `).run(
      totals.subtotalCents, totals.discountCents, totals.taxCents, totals.tipCents,
      timestamp, staffId, newReceiptToken(), businessDateFor(now, config.timezone), timestamp, id,
    );
    if (raw.table_id !== null) {
      db.prepare("UPDATE restaurant_tables SET status = 'libre' WHERE id = ?").run(raw.table_id);
    }
    consumeInventoryForOrder(db, id, staffId, timestamp);
    audit(db, staffId, 'order.courtesy', 'order', id, {
      reason: cleanReason,
      discountType: raw.discount_type,
      discountValue: Number(raw.discount_value),
      discountCents: totals.discountCents,
      totalCents: 0,
    });
  });
  return getOrder(db, id);
}

export function reverseInventoryForOrder(db, orderId, staffId, now = new Date().toISOString()) {
  const movements = db
    .prepare("SELECT * FROM inventory_movements WHERE order_id = ? AND type = 'consumption'")
    .all(orderId);
  if (movements.length === 0) return 0;
  const order = db.prepare('SELECT order_number FROM orders WHERE id = ?').get(orderId);
  const update = db.prepare('UPDATE inventory_items SET current_milli = current_milli + ?, updated_at = ? WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO inventory_movements (item_id, type, quantity_milli, reference, notes, order_id, staff_id, created_at)
    VALUES (?, 'adjustment', ?, ?, 'Reverso por reembolso', ?, ?, ?)
  `);
  for (const movement of movements) {
    const restore = Math.abs(Number(movement.quantity_milli));
    update.run(restore, now, movement.item_id);
    insert.run(movement.item_id, restore, order?.order_number ?? `Pedido ${orderId}`, orderId, staffId, now);
  }
  return movements.length;
}

export function refundOrder(db, config, id, { reason, amountCents: requestedAmount, authorizedById, staffId = null, now = new Date() } = {}) {
  const cleanReason = String(reason ?? '').trim();
  if (cleanReason.length < 3) throw validationError('Indica el motivo del reembolso.');
  const timestamp = now.toISOString();
  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'pagada') throw conflict('Solo se pueden reembolsar pedidos pagados.');
    if (raw.refunded_at) throw conflict('Este pedido ya fue reembolsado por completo.');
    const totalCents = Number(raw.total_cents);
    const alreadyRefunded = Number(raw.refund_cents ?? 0);
    const remaining = totalCents - alreadyRefunded;
    if (remaining <= 0) throw conflict('Este pedido no tiene saldo por reembolsar.');
    const amountCents = requestedAmount === undefined ? remaining : Number(requestedAmount);
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw validationError('El monto del reembolso debe ser un entero positivo.');
    if (amountCents > remaining) throw validationError('El reembolso no puede superar el saldo pendiente.');
    const cashPaid = Number(
      db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM payments WHERE order_id = ? AND method_kind = 'cash'").get(id).total,
    );
    const cashRefunded = Number(
      db.prepare("SELECT COALESCE(SUM(cash_cents), 0) AS total FROM refunds WHERE order_id = ?").get(id).total,
    );
    const cashCents = Math.min(amountCents, Math.max(0, cashPaid - cashRefunded));
    const openShift = db.prepare("SELECT id FROM shifts WHERE status = 'open' LIMIT 1").get();
    if (cashCents > 0 && !openShift) {
      throw conflict('Abre un turno de caja para registrar el reembolso en efectivo.');
    }
    db.prepare(`
      INSERT INTO refunds (order_id, shift_id, staff_id, authorized_by_staff_id, amount_cents, cash_cents, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, openShift?.id ?? null, staffId, authorizedById, amountCents, cashCents, cleanReason, timestamp);
    const cumulativeRefund = alreadyRefunded + amountCents;
    db.prepare(`
      UPDATE orders SET refunded_at = ?, refund_cents = ?, refund_reason = ?, updated_at = ? WHERE id = ?
    `).run(cumulativeRefund >= totalCents ? timestamp : null, cumulativeRefund, cleanReason, timestamp, id);
    if (cumulativeRefund >= totalCents) {
      reverseInventoryForOrder(db, id, staffId, timestamp);
      reverseLoyaltyForOrder(db, id, timestamp);
    }
    audit(db, staffId, 'order.refund', 'order', id, {
      amountCents,
      cumulativeRefund,
      cashCents,
      reason: cleanReason,
      authorizedById,
      authorizedRole: db.prepare('SELECT role FROM staff WHERE id = ?').get(authorizedById)?.role ?? null,
      shiftId: openShift?.id ?? null,
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
    if (db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(id).count > 0) {
      throw conflict('No se puede anular un pedido con la cuenta dividida.');
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
