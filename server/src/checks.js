import { randomBytes } from 'node:crypto';
import { calculateTotals } from '@restpos/shared/pricing';
import { conflict, notFound, validationError } from './errors.js';
import { transaction } from './db.js';
import { audit } from './audit.js';

function allocate(total, weights) {
  const safeTotal = Math.max(0, Math.round(Number(total) || 0));
  const clean = (weights ?? []).map((value) => Math.max(0, Number(value) || 0));
  if (clean.length === 0) return [];
  if (safeTotal === 0) return clean.map(() => 0);
  const sum = clean.reduce((acc, value) => acc + value, 0);
  const effective = sum === 0 ? clean.map(() => 1) : clean;
  const effectiveSum = effective.reduce((acc, value) => acc + value, 0);
  const raw = effective.map((value) => (safeTotal * value) / effectiveSum);
  const result = raw.map((value) => Math.floor(value));
  let remaining = safeTotal - result.reduce((acc, value) => acc + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; remaining > 0; index += 1) {
    result[order[index % order.length].index] += 1;
    remaining -= 1;
  }
  return result;
}

function token() {
  return randomBytes(24).toString('base64url');
}

export function serializeCheck(row, lines = [], payments = []) {
  const total = Number(row.total_cents);
  const paid = Number(row.amount_paid_cents);
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    label: row.label,
    status: row.status,
    tipType: row.tip_type,
    tipValue: Number(row.tip_value),
    tipCents: Number(row.tip_cents),
    subtotalCents: Number(row.subtotal_cents),
    discountCents: Number(row.discount_cents),
    taxCents: Number(row.tax_cents),
    deliveryCents: Number(row.delivery_cents),
    totalCents: total,
    amountPaidCents: paid,
    balanceCents: Math.max(0, total - paid),
    lines,
    payments,
    publicReceiptToken: row.public_receipt_token ?? null,
    createdAt: row.created_at,
    paidAt: row.paid_at ?? null,
  };
}

function loadCheckRows(db, orderId) {
  return db.prepare('SELECT * FROM order_checks WHERE order_id = ? ORDER BY id').all(orderId);
}

function loadLineRows(db, orderId) {
  return db.prepare(`
    SELECT cl.*, oi.product_name, oi.quantity AS item_quantity, oi.unit_price_cents, oi.line_total_cents,
           oi.notes, oi.sort_order
    FROM order_check_lines cl
    JOIN order_items oi ON oi.id = cl.order_item_id
    JOIN order_checks c ON c.id = cl.check_id
    WHERE c.order_id = ?
    ORDER BY c.id, oi.sort_order, oi.id
  `).all(orderId);
}

function loadCheckPayments(db, orderId) {
  return db.prepare(`
    SELECT p.*, st.name AS staff_name FROM payments p
    LEFT JOIN staff st ON st.id = p.staff_id
    WHERE p.order_id = ? AND p.check_id IS NOT NULL ORDER BY p.created_at, p.id
  `).all(orderId);
}

function lineAmounts(db, orderId, lines) {
  const items = db.prepare('SELECT id, line_total_cents FROM order_items WHERE order_id = ?').all(orderId);
  const byItem = new Map();
  for (const line of lines) {
    if (!byItem.has(Number(line.order_item_id))) byItem.set(Number(line.order_item_id), []);
    byItem.get(Number(line.order_item_id)).push(line);
  }
  const amountByLine = new Map();
  for (const item of items) {
    const shares = byItem.get(Number(item.id)) ?? [];
    if (shares.length === 0) continue;
    const amounts = allocate(Number(item.line_total_cents), shares.map((line) => Number(line.quantity_milli)));
    shares.forEach((line, index) => amountByLine.set(Number(line.id), amounts[index]));
  }
  return amountByLine;
}

export function listOrderChecks(db, orderId) {
  const checks = loadCheckRows(db, orderId);
  if (checks.length === 0) return [];
  const lines = loadLineRows(db, orderId);
  const amounts = lineAmounts(db, orderId, lines);
  const payments = loadCheckPayments(db, orderId);
  return checks.map((check) => {
    const checkLines = lines.filter((line) => Number(line.check_id) === Number(check.id)).map((line) => ({
      id: Number(line.id),
      orderItemId: Number(line.order_item_id),
      productName: line.product_name,
      quantityMilli: Number(line.quantity_milli),
      quantity: Number(line.quantity_milli) / 1000,
      notes: line.notes,
      lineTotalCents: amounts.get(Number(line.id)) ?? 0,
    }));
    const checkPayments = payments.filter((payment) => Number(payment.check_id) === Number(check.id)).map((payment) => ({
      id: Number(payment.id),
      paymentMethod: payment.payment_method,
      paymentMethodName: payment.method_name || payment.payment_method,
      amountCents: Number(payment.amount_cents),
      cashReceivedCents: payment.cash_received_cents === null ? null : Number(payment.cash_received_cents),
      changeCents: payment.change_cents === null ? null : Number(payment.change_cents),
      createdAt: payment.created_at,
    }));
    return serializeCheck(check, checkLines, checkPayments);
  });
}

export function recalculateChecks(db, orderId, now = new Date().toISOString()) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw notFound('No se encontró el pedido.');
  const checks = loadCheckRows(db, orderId);
  if (checks.length === 0) return [];
  const lines = loadLineRows(db, orderId);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id').all(orderId);
  const byItem = new Map();
  for (const line of lines) {
    if (!byItem.has(Number(line.order_item_id))) byItem.set(Number(line.order_item_id), []);
    byItem.get(Number(line.order_item_id)).push(line);
  }
  const subtotals = new Map(checks.map((check) => [Number(check.id), 0]));
  for (const item of items) {
    const shares = byItem.get(Number(item.id)) ?? [];
    if (shares.length === 0) continue;
    const amounts = allocate(Number(item.line_total_cents), shares.map((line) => Number(line.quantity_milli)));
    shares.forEach((line, index) => {
      const id = Number(line.check_id);
      subtotals.set(id, (subtotals.get(id) ?? 0) + amounts[index]);
    });
  }
  const subtotalWeights = checks.map((check) => subtotals.get(Number(check.id)));
  const discounts = allocate(Number(order.discount_cents), subtotalWeights);
  const taxable = checks.map((check, index) => Math.max(0, subtotals.get(Number(check.id)) - discounts[index]));
  const taxes = allocate(Number(order.tax_cents), taxable);
  const deliveries = allocate(Number(order.delivery_fee_cents), subtotalWeights);
  const results = [];
  let tipsTotal = 0;
  checks.forEach((check, index) => {
    const subtotal = subtotals.get(Number(check.id));
    const discount = discounts[index];
    const tax = taxes[index];
    const delivery = deliveries[index];
    const preTip = subtotal - discount + tax + delivery;
    const tipValue = Number(check.tip_value);
    const tip = check.tip_type === 'percent'
      ? Math.floor((preTip * tipValue + 5000) / 10000)
      : check.tip_type === 'fixed' ? tipValue : 0;
    const total = preTip + tip;
    tipsTotal += tip;
    db.prepare(`
      UPDATE order_checks SET subtotal_cents = ?, discount_cents = ?, tax_cents = ?,
        delivery_cents = ?, tip_cents = ?, total_cents = ?
      WHERE id = ?
    `).run(subtotal, discount, tax, delivery, tip, total, check.id);
    results.push({ id: Number(check.id), subtotal, discount, tax, delivery, tip, total });
  });
  for (const item of items) {
    const shares = byItem.get(Number(item.id)) ?? [];
    const full = shares.filter((line) => Number(line.quantity_milli) === Number(item.quantity) * 1000);
    db.prepare('UPDATE order_items SET check_id = ? WHERE id = ?')
      .run(shares.length === 1 && full.length === 1 ? Number(shares[0].check_id) : null, item.id);
  }
  db.prepare(`
    UPDATE orders SET tip_type = 'fixed', tip_value = ?, tip_cents = ?, total_cents = ?, updated_at = ?
    WHERE id = ?
  `).run(tipsTotal, tipsTotal, results.reduce((sum, result) => sum + result.total, 0), now, orderId);
  return listOrderChecks(db, orderId);
}

function validateOrderForSplit(db, order) {
  if (order.status !== 'abierta') throw conflict('El pedido ya está cerrado.');
  if (Number(order.amount_paid_cents) > 0) throw conflict('No se puede dividir un pedido con pagos registrados.');
  if (db.prepare('SELECT COUNT(*) AS count FROM order_checks WHERE order_id = ?').get(order.id).count > 0) {
    throw conflict('El pedido ya tiene cuentas.');
  }
  if (db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(order.id).count > 0) {
    throw conflict('El pedido ya tiene una división anterior.');
  }
}

function groupShares(db, orderId, groups) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id').all(orderId);
  const itemMap = new Map(items.map((item) => [Number(item.id), item]));
  const totals = new Map();
  const normalized = groups.map((group, index) => {
    const shares = (group.shares ?? []).map((share) => ({ orderItemId: Number(share.orderItemId ?? share.itemId), quantityMilli: Number(share.quantityMilli ?? (Number(share.quantity) * 1000)) }));
    if (shares.length === 0) throw validationError(`La cuenta "${group.label ?? index + 1}" no tiene productos.`);
    for (const share of shares) {
      const item = itemMap.get(share.orderItemId);
      if (!item) throw validationError('Una línea no pertenece al pedido.');
      if (!Number.isInteger(share.quantityMilli) || share.quantityMilli <= 0) throw validationError('La cantidad de una cuenta no es válida.');
      totals.set(share.orderItemId, (totals.get(share.orderItemId) ?? 0) + share.quantityMilli);
    }
    return { label: String(group.label ?? `Cuenta ${index + 1}`).trim().slice(0, 40) || `Cuenta ${index + 1}`, shares };
  });
  for (const item of items) {
    if ((totals.get(Number(item.id)) ?? 0) !== Number(item.quantity) * 1000) {
      throw validationError(`Asigna toda la cantidad de "${item.product_name}" entre las cuentas.`);
    }
  }
  return normalized;
}

export function createChecks(db, orderId, groups, staffId, now = new Date().toISOString()) {
  return transaction(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw notFound('No se encontró el pedido.');
    validateOrderForSplit(db, order);
    if (!Array.isArray(groups) || groups.length < 2 || groups.length > 20) throw validationError('Crea entre 2 y 20 cuentas.');
    const normalized = groupShares(db, orderId, groups);
    const originalTip = { type: order.tip_type, value: Number(order.tip_value), cents: Number(order.tip_cents) };
    db.prepare('UPDATE orders SET precheck_tip_type = ?, precheck_tip_value = ?, precheck_tip_cents = ?, tip_type = \'none\', tip_value = 0, tip_cents = 0, updated_at = ? WHERE id = ?')
      .run(originalTip.type, originalTip.value, originalTip.cents, now, orderId);
    const insertCheck = db.prepare('INSERT INTO order_checks (order_id, label, created_at, created_by_staff_id) VALUES (?, ?, ?, ?)');
    const insertLine = db.prepare('INSERT INTO order_check_lines (check_id, order_item_id, quantity_milli, created_at) VALUES (?, ?, ?, ?)');
    for (const group of normalized) {
      const result = insertCheck.run(orderId, group.label, now, staffId);
      for (const share of group.shares) insertLine.run(Number(result.lastInsertRowid), share.orderItemId, share.quantityMilli, now);
    }
    recalculateChecks(db, orderId, now);
    if (originalTip.cents > 0) {
      const created = loadCheckRows(db, orderId);
      const tips = allocate(originalTip.cents, created.map((check) => Number(check.subtotal_cents)));
      created.forEach((check, index) => db.prepare("UPDATE order_checks SET tip_type = 'fixed', tip_value = ? WHERE id = ?").run(tips[index], check.id));
      recalculateChecks(db, orderId, now);
    }
    audit(db, staffId, 'order.checks.create', 'order', orderId, {
      checkCount: normalized.length,
      labels: normalized.map((group) => group.label),
      originalTipCents: originalTip.cents,
    });
    return listOrderChecks(db, orderId);
  });
}

export function createEqualChecks(db, orderId, count, staffId, now = new Date().toISOString()) {
  if (!Number.isInteger(count) || count < 2 || count > 20) throw validationError('Crea entre 2 y 20 cuentas.');
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw notFound('No se encontró el pedido.');
  validateOrderForSplit(db, order);
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY sort_order, id').all(orderId);
  if (items.length === 0) throw validationError('Agrega productos antes de dividir.');
  const groups = Array.from({ length: count }, (_, index) => ({ label: `Parte ${index + 1}`, shares: [] }));
  for (const item of items) {
    const quantities = allocate(Number(item.quantity) * 1000, Array.from({ length: count }, () => 1));
    quantities.forEach((quantity, index) => {
      if (quantity > 0) groups[index].shares.push({ orderItemId: Number(item.id), quantityMilli: quantity });
    });
  }
  return createChecks(db, orderId, groups, staffId, now);
}

export function moveCheckLine(db, orderId, input, staffId, now = new Date().toISOString()) {
  return transaction(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || order.status !== 'abierta') throw conflict('El pedido ya está cerrado.');
    const from = db.prepare('SELECT * FROM order_checks WHERE id = ? AND order_id = ?').get(input.fromCheckId, orderId);
    const to = db.prepare('SELECT * FROM order_checks WHERE id = ? AND order_id = ?').get(input.toCheckId, orderId);
    if (!from || !to) throw notFound('No se encontró una de las cuentas.');
    if (from.status === 'paid' || to.status === 'paid') throw conflict('No se pueden mover líneas a una cuenta pagada.');
    const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(input.orderItemId, orderId);
    if (!item) throw notFound('No se encontró la línea.');
    const source = db.prepare('SELECT * FROM order_check_lines WHERE check_id = ? AND order_item_id = ?').get(from.id, item.id);
    if (!source) throw conflict('La línea no está en esa cuenta.');
    const quantity = input.quantityMilli === undefined ? Number(source.quantity_milli) : Number(input.quantityMilli);
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > Number(source.quantity_milli)) throw validationError('Cantidad inválida.');
    if (quantity === Number(source.quantity_milli)) {
      db.prepare('UPDATE order_check_lines SET check_id = ? WHERE id = ?').run(to.id, source.id);
    } else {
      db.prepare('UPDATE order_check_lines SET quantity_milli = quantity_milli - ? WHERE id = ?').run(quantity, source.id);
      const existing = db.prepare('SELECT * FROM order_check_lines WHERE check_id = ? AND order_item_id = ?').get(to.id, item.id);
      if (existing) db.prepare('UPDATE order_check_lines SET quantity_milli = quantity_milli + ? WHERE id = ?').run(quantity, existing.id);
      else db.prepare('INSERT INTO order_check_lines (check_id, order_item_id, quantity_milli, created_at) VALUES (?, ?, ?, ?)').run(to.id, item.id, quantity, now);
    }
    recalculateChecks(db, orderId, now);
    audit(db, staffId, 'order.checks.move_line', 'order', orderId, { fromCheckId: Number(from.id), toCheckId: Number(to.id), orderItemId: Number(item.id), quantityMilli: quantity });
    return listOrderChecks(db, orderId);
  });
}

export function mergeChecks(db, orderId, sourceId, targetId, staffId, now = new Date().toISOString()) {
  return transaction(db, () => {
    const source = db.prepare('SELECT * FROM order_checks WHERE id = ? AND order_id = ?').get(sourceId, orderId);
    const target = db.prepare('SELECT * FROM order_checks WHERE id = ? AND order_id = ?').get(targetId, orderId);
    if (!source || !target) throw notFound('No se encontró una de las cuentas.');
    if (source.status === 'paid' || target.status === 'paid') throw conflict('No se pueden fusionar cuentas pagadas.');
    const lines = db.prepare('SELECT * FROM order_check_lines WHERE check_id = ?').all(source.id);
    for (const line of lines) {
      const existing = db.prepare('SELECT * FROM order_check_lines WHERE check_id = ? AND order_item_id = ?').get(target.id, line.order_item_id);
      if (existing) db.prepare('UPDATE order_check_lines SET quantity_milli = quantity_milli + ? WHERE id = ?').run(line.quantity_milli, existing.id);
      else db.prepare('UPDATE order_check_lines SET check_id = ? WHERE id = ?').run(target.id, line.id);
    }
    db.prepare('DELETE FROM order_check_lines WHERE check_id = ?').run(source.id);
    db.prepare('UPDATE order_checks SET tip_type = \'fixed\', tip_value = ? WHERE id = ?').run(Number(source.tip_cents) + Number(target.tip_cents), target.id);
    db.prepare('DELETE FROM order_checks WHERE id = ?').run(source.id);
    recalculateChecks(db, orderId, now);
    audit(db, staffId, 'order.checks.merge', 'order', orderId, { sourceCheckId: Number(sourceId), targetCheckId: Number(targetId) });
    return listOrderChecks(db, orderId);
  });
}

export function updateCheckTip(db, orderId, checkId, input, staffId, now = new Date().toISOString()) {
  return transaction(db, () => {
    const check = db.prepare('SELECT * FROM order_checks WHERE id = ? AND order_id = ?').get(checkId, orderId);
    if (!check) throw notFound('No se encontró la cuenta.');
    if (check.status === 'paid') throw conflict('No se puede modificar una cuenta pagada.');
    if (!['none', 'percent', 'fixed'].includes(input.tipType)) throw validationError('Tipo de propina inválido.');
    if (!Number.isInteger(input.tipValue) || input.tipValue < 0) throw validationError('Propina inválida.');
    db.prepare('UPDATE order_checks SET tip_type = ?, tip_value = ? WHERE id = ?').run(input.tipType, input.tipValue, check.id);
    recalculateChecks(db, orderId, now);
    audit(db, staffId, 'order.checks.tip', 'order', orderId, { checkId: Number(check.id), tipType: input.tipType, tipValue: input.tipValue });
    return listOrderChecks(db, orderId);
  });
}

export function undoChecks(db, orderId, staffId, now = new Date().toISOString()) {
  return transaction(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw notFound('No se encontró el pedido.');
    if (Number(order.amount_paid_cents) > 0) throw conflict('No se puede deshacer una división con pagos.');
    const count = db.prepare('SELECT COUNT(*) AS count FROM order_checks WHERE order_id = ?').get(orderId).count;
    if (count === 0) throw conflict('El pedido no tiene cuentas.');
    db.prepare('UPDATE order_items SET check_id = NULL WHERE order_id = ?').run(orderId);
    db.prepare('DELETE FROM order_check_lines WHERE check_id IN (SELECT id FROM order_checks WHERE order_id = ?)').run(orderId);
    db.prepare('DELETE FROM order_checks WHERE order_id = ?').run(orderId);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    const totals = calculateTotals({
      items: items.map((item) => ({ unitPriceCents: Number(item.unit_price_cents), quantity: Number(item.quantity) })),
      discountType: order.discount_type, discountValue: Number(order.discount_value),
      tipType: order.precheck_tip_type ?? 'none', tipValue: Number(order.precheck_tip_value ?? 0),
      taxRateBps: Number(order.tax_rate_bps),
    });
    db.prepare(`
      UPDATE orders SET tip_type = ?, tip_value = ?, tip_cents = ?, total_cents = ?,
        precheck_tip_type = NULL, precheck_tip_value = NULL, precheck_tip_cents = NULL, updated_at = ?
      WHERE id = ?
    `).run(order.precheck_tip_type ?? 'none', Number(order.precheck_tip_value ?? 0), totals.tipCents, totals.totalCents + Number(order.delivery_fee_cents), now, orderId);
    audit(db, staffId, 'order.checks.undo', 'order', orderId, { checkCount: count });
    return listOrderChecks(db, orderId);
  });
}

export function markCheckReceiptToken(db, checkId, now = new Date().toISOString()) {
  const check = db.prepare('SELECT * FROM order_checks WHERE id = ?').get(checkId);
  if (!check) throw notFound('No se encontró la cuenta.');
  if (check.status !== 'paid') throw conflict('Solo puedes compartir el ticket de una cuenta pagada.');
  if (!check.public_receipt_token) {
    const value = token();
    db.prepare('UPDATE order_checks SET public_receipt_token = ? WHERE id = ?').run(value, checkId);
    return value;
  }
  return check.public_receipt_token;
}
