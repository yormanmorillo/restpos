import { randomUUID } from 'node:crypto';
import { calculateLineTotal, calculateTotals, calculateChange } from '@restpos/shared/pricing';
import { businessDateFor } from './business-date.js';
import { transaction } from './db.js';
import { conflict, notFound, unprocessable, validationError } from './errors.js';
import { serializeOrder } from './serializers.js';

const ORDER_SELECT = `
  SELECT o.*, t.name AS table_name
  FROM orders o
  LEFT JOIN restaurant_tables t ON t.id = o.table_id
`;

function isUniqueViolation(error) {
  return /UNIQUE constraint failed/i.test(error?.message ?? '');
}

function loadRawOrder(db, id) {
  const row = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id);
  if (!row) throw notFound('No se encontró el pedido.');
  return row;
}

function loadItems(db, orderId) {
  return db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id')
    .all(orderId);
}

export function getOrder(db, id) {
  const row = loadRawOrder(db, id);
  return serializeOrder(row, loadItems(db, id));
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
    discountType: discountType === 'none' ? 'none' : discountType,
    discountValue: discountType === 'none' ? 0 : discountValue,
    tipType: tipType === 'none' ? 'none' : tipType,
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

export function createOrder(db, config, input, { now = new Date() } = {}) {
  const timestamp = now.toISOString();
  let orderId;

  try {
    transaction(db, () => {
      if (input.type === 'mesa') {
        const table = db.prepare('SELECT id, name FROM restaurant_tables WHERE id = ?').get(input.tableId);
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
            (order_number, type, table_id, status, customer_name, notes, tax_rate_bps,
             business_date, created_at, updated_at)
          VALUES (?, ?, ?, 'abierta', ?, ?, ?, ?, ?, ?)
        `)
        .run(
          `TMP-${randomUUID()}`,
          input.type,
          input.type === 'mesa' ? input.tableId : null,
          input.customerName ?? '',
          input.notes ?? '',
          config.taxRateBps,
          businessDateFor(now, config.timezone),
          timestamp,
          timestamp,
        );
      orderId = Number(result.lastInsertRowid);
      const orderNumber = `P-${String(orderId).padStart(5, '0')}`;
      db.prepare('UPDATE orders SET order_number = ? WHERE id = ?').run(orderNumber, orderId);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('La mesa ya tiene un pedido abierto.');
    }
    throw error;
  }

  return getOrder(db, orderId);
}

export function updateOrderDraft(db, config, id, input, { now = new Date() } = {}) {
  const timestamp = now.toISOString();

  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') {
      throw conflict('Este pedido ya no se puede modificar.', { status: raw.status });
    }

    const existingItems = loadItems(db, id);
    const existingByKey = new Map(existingItems.map((item) => [item.client_key, item]));
    const existingProductIds = new Set(
      existingItems.filter((item) => item.product_id !== null).map((item) => Number(item.product_id)),
    );
    const sourceItems = input.items ?? existingItems.map((item) => ({
      clientKey: item.client_key,
      productId: item.product_id,
      quantity: item.quantity,
      notes: item.notes,
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
        return {
          clientKey: line.clientKey,
          productId: line.productId,
          productName: existing.product_name,
          unitPriceCents: Number(existing.unit_price_cents),
          quantity: line.quantity,
          notes: line.notes ?? '',
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
      return {
        clientKey: line.clientKey,
        productId: Number(product.id),
        productName: product.name,
        unitPriceCents: Number(product.price_cents),
        quantity: line.quantity,
        notes: line.notes ?? '',
        lineTotalCents: calculateLineTotal(Number(product.price_cents), line.quantity),
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
         line_total_cents, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    normalizedItems.forEach((item, index) => {
      insertItem.run(
        id,
        item.clientKey,
        item.productId,
        item.productName,
        item.unitPriceCents,
        item.quantity,
        item.notes,
        item.lineTotalCents,
        index,
      );
    });

    db.prepare(`
      UPDATE orders SET
        customer_name = ?,
        notes = ?,
        subtotal_cents = ?,
        discount_type = ?,
        discount_value = ?,
        discount_cents = ?,
        tax_cents = ?,
        tip_type = ?,
        tip_value = ?,
        tip_cents = ?,
        total_cents = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.customerName !== undefined ? input.customerName : raw.customer_name,
      input.notes !== undefined ? input.notes : raw.notes,
      totals.subtotalCents,
      adjustments.discountType,
      adjustments.discountValue,
      totals.discountCents,
      totals.taxCents,
      adjustments.tipType,
      adjustments.tipValue,
      totals.tipCents,
      totals.totalCents,
      timestamp,
      id,
    );
  });

  return getOrder(db, id);
}

export function payOrder(db, config, id, input, { now = new Date() } = {}) {
  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') {
      throw conflict('Este pedido ya fue cerrado.', { status: raw.status });
    }
    const items = loadItems(db, id);
    if (items.length === 0) {
      throw unprocessable('Agrega al menos un producto antes de cobrar.');
    }

    const totals = safeTotals({
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

    let cashReceivedCents = null;
    let changeCents = 0;
    if (input.paymentMethod === 'efectivo') {
      cashReceivedCents = input.cashReceivedCents ?? 0;
      if (cashReceivedCents < totals.totalCents) {
        throw unprocessable('El efectivo recibido no cubre el total del pedido.', {
          totalCents: totals.totalCents,
          cashReceivedCents,
          missingCents: totals.totalCents - cashReceivedCents,
        });
      }
      changeCents = calculateChange(totals.totalCents, cashReceivedCents);
    }

    const timestamp = now.toISOString();
    db.prepare(`
      UPDATE orders SET
        status = 'pagada',
        payment_method = ?,
        cash_received_cents = ?,
        change_cents = ?,
        subtotal_cents = ?,
        discount_cents = ?,
        tax_cents = ?,
        tip_cents = ?,
        total_cents = ?,
        business_date = ?,
        paid_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.paymentMethod,
      cashReceivedCents,
      changeCents,
      totals.subtotalCents,
      totals.discountCents,
      totals.taxCents,
      totals.tipCents,
      totals.totalCents,
      businessDateFor(now, config.timezone),
      timestamp,
      timestamp,
      id,
    );

    if (raw.table_id !== null) {
      db.prepare("UPDATE restaurant_tables SET status = 'libre' WHERE id = ?").run(raw.table_id);
    }
  });

  return getOrder(db, id);
}

export function cancelOrder(db, id, { now = new Date() } = {}) {
  transaction(db, () => {
    const raw = loadRawOrder(db, id);
    if (raw.status !== 'abierta') {
      throw conflict('Solo se pueden anular pedidos abiertos.', { status: raw.status });
    }
    const timestamp = now.toISOString();
    db.prepare(`
      UPDATE orders SET status = 'anulada', cancelled_at = ?, updated_at = ? WHERE id = ?
    `).run(timestamp, timestamp, id);
    if (raw.table_id !== null) {
      db.prepare("UPDATE restaurant_tables SET status = 'libre' WHERE id = ?").run(raw.table_id);
    }
  });
  return getOrder(db, id);
}

export function listOrders(db, { status, type, date, limit = 50, offset = 0 }) {
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
      SELECT o.*, t.name AS table_name,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS item_count
      FROM orders o
      LEFT JOIN restaurant_tables t ON t.id = o.table_id
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
        t.id, t.name, t.capacity,
        o.id AS open_order_id,
        o.order_number AS open_order_number,
        o.total_cents AS open_order_total_cents,
        o.customer_name AS open_order_customer_name,
        o.created_at AS open_order_created_at,
        (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) AS open_order_item_count
      FROM restaurant_tables t
      LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'abierta'
      ORDER BY t.id
    `)
    .all();
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    capacity: Number(row.capacity),
    status: row.open_order_id ? 'ocupada' : 'libre',
    openOrder: row.open_order_id
      ? {
          id: Number(row.open_order_id),
          orderNumber: row.open_order_number,
          totalCents: Number(row.open_order_total_cents),
          itemCount: Number(row.open_order_item_count),
          customerName: row.open_order_customer_name,
          openedAt: row.open_order_created_at,
        }
      : null,
  }));
}

