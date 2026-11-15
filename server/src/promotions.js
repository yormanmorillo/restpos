import { calculateTotals } from '@restpos/shared/pricing';
import { conflict, notFound, validationError } from './errors.js';
import { transaction } from './db.js';
import { audit } from './audit.js';

export function serializePromotion(row) {
  return {
    id: Number(row.id), code: row.code, name: row.name, type: row.type,
    value: Number(row.value), minSubtotalCents: Number(row.min_subtotal_cents),
    maxUses: Number(row.max_uses), uses: Number(row.uses), active: Boolean(row.active),
    startsAt: row.starts_at ?? null, endsAt: row.ends_at ?? null, notes: row.notes,
    autoApply: Boolean(row.auto_apply), daysOfWeek: row.days_of_week ?? '', startTime: row.start_time ?? null, endTime: row.end_time ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function listPromotions(db) {
  return db.prepare('SELECT * FROM promotions ORDER BY active DESC, created_at DESC').all().map(serializePromotion);
}

function validateInput(input, partial = false) {
  if (!partial || input.type !== undefined) {
    if (!['percent', 'fixed'].includes(input.type)) throw validationError('Tipo de promoción inválido.');
  }
  if (!partial || input.value !== undefined) {
    if (!Number.isInteger(input.value) || input.value < 0) throw validationError('El valor de la promoción no es válido.');
    if (input.type === 'percent' && input.value > 10000) throw validationError('El porcentaje no puede superar 100%.');
  }
}

export function createPromotion(db, input, staffId, now = new Date().toISOString()) {
  validateInput(input);
  const code = String(input.code ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw validationError('El código debe tener entre 3 y 40 caracteres.');
  if (db.prepare('SELECT id FROM promotions WHERE code = ? COLLATE NOCASE').get(code)) throw conflict('Ya existe una promoción con ese código.');
  const result = db.prepare(`
    INSERT INTO promotions
      (code, name, type, value, min_subtotal_cents, max_uses, active, starts_at, ends_at, notes, auto_apply, days_of_week, start_time, end_time, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, input.name.trim(), input.type, input.value, input.minSubtotalCents ?? 0, input.maxUses ?? 0, input.active === false ? 0 : 1, input.startsAt ?? null, input.endsAt ?? null, input.notes ?? '', input.autoApply ? 1 : 0, input.daysOfWeek ?? '', input.startTime ?? null, input.endTime ?? null, now, now);
  const id = Number(result.lastInsertRowid);
  audit(db, staffId, 'promotion.create', 'promotion', id, { code });
  return serializePromotion(db.prepare('SELECT * FROM promotions WHERE id = ?').get(id));
}

export function updatePromotion(db, id, input, staffId, now = new Date().toISOString()) {
  const existing = db.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
  if (!existing) throw notFound('No se encontró la promoción.');
  validateInput(input, true);
  const fields = [];
  const params = [];
  const mapping = [['code', 'code'], ['name', 'name'], ['type', 'type'], ['value', 'value'], ['minSubtotalCents', 'min_subtotal_cents'], ['maxUses', 'max_uses'], ['active', 'active'], ['startsAt', 'starts_at'], ['endsAt', 'ends_at'], ['notes', 'notes'], ['autoApply', 'auto_apply'], ['daysOfWeek', 'days_of_week'], ['startTime', 'start_time'], ['endTime', 'end_time']];
  for (const [key, column] of mapping) {
    if (input[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(['active', 'autoApply'].includes(key) ? (input[key] ? 1 : 0) : key === 'code' ? String(input[key]).trim().toUpperCase() : input[key]);
    }
  }
  if (fields.length === 0) throw validationError('No hay cambios para guardar.');
  fields.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE promotions SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  audit(db, staffId, 'promotion.update', 'promotion', id, input);
  return serializePromotion(db.prepare('SELECT * FROM promotions WHERE id = ?').get(id));
}

function activePromotion(db, code, subtotalCents, now) {
  const promotion = db.prepare('SELECT * FROM promotions WHERE code = ? COLLATE NOCASE AND active = 1').get(String(code ?? '').trim().toUpperCase());
  if (!promotion) throw notFound('El cupón no existe o no está activo.');
  if (promotion.starts_at && new Date(promotion.starts_at).getTime() > now.getTime()) throw conflict('El cupón todavía no está vigente.');
  if (promotion.ends_at && new Date(promotion.ends_at).getTime() < now.getTime()) throw conflict('El cupón está vencido.');
  if (promotion.max_uses > 0 && promotion.uses >= promotion.max_uses) throw conflict('El cupón alcanzó su límite de usos.');
  if (subtotalCents < Number(promotion.min_subtotal_cents)) throw conflict('El pedido no alcanza el mínimo para este cupón.');
  return promotion;
}

export function applyPromotion(db, orderId, code, staffId, now = new Date()) {
  return transaction(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw notFound('No se encontró el pedido.');
    if (order.status !== 'abierta') throw conflict('El pedido ya está cerrado.');
    if (Number(order.amount_paid_cents) > 0) throw conflict('No se puede aplicar un cupón con pagos registrados.');
    if (db.prepare('SELECT COUNT(*) AS count FROM order_splits WHERE order_id = ?').get(orderId).count > 0) throw conflict('No se puede aplicar un cupón a una cuenta dividida.');
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    const subtotal = items.reduce((sum, item) => sum + Number(item.line_total_cents), 0);
    const promotion = activePromotion(db, code, subtotal, now);
    if (order.promotion_id) {
      db.prepare('UPDATE promotions SET uses = MAX(0, uses - 1) WHERE id = ?').run(order.promotion_id);
    }
    const totals = calculateTotals({
      items: items.map((item) => ({ unitPriceCents: Number(item.unit_price_cents), quantity: Number(item.quantity) })),
      discountType: promotion.type,
      discountValue: Number(promotion.value),
      tipType: order.tip_type,
      tipValue: Number(order.tip_value),
      taxRateBps: Number(order.tax_rate_bps),
    });
    const timestamp = now.toISOString();
    db.prepare(`
      UPDATE orders SET discount_type = ?, discount_value = ?, discount_cents = ?, discount_reason = ?,
        promotion_id = ?, promotion_code = ?, subtotal_cents = ?, tax_cents = ?, tip_cents = ?,
        total_cents = ?, updated_at = ? WHERE id = ?
    `).run(
      promotion.type, Number(promotion.value), totals.discountCents, `Cupón ${promotion.code}`,
      promotion.id, promotion.code, totals.subtotalCents, totals.taxCents, totals.tipCents,
      totals.totalCents + Number(order.delivery_fee_cents ?? 0), timestamp, orderId,
    );
    db.prepare('UPDATE promotions SET uses = uses + 1 WHERE id = ?').run(promotion.id);
    audit(db, staffId, 'order.promotion.apply', 'order', orderId, {
      promotionId: Number(promotion.id), code: promotion.code, discountCents: totals.discountCents, minSubtotalCents: promotion.min_subtotal_cents,
    });
    return getPromotionOrder(db, orderId);
  });
}

export function removePromotion(db, orderId, staffId, now = new Date()) {
  return transaction(db, () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) throw notFound('No se encontró el pedido.');
    if (order.status !== 'abierta') throw conflict('El pedido ya está cerrado.');
    if (!order.promotion_id) throw conflict('El pedido no tiene cupón.');
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    const totals = calculateTotals({
      items: items.map((item) => ({ unitPriceCents: Number(item.unit_price_cents), quantity: Number(item.quantity) })),
      tipType: order.tip_type, tipValue: Number(order.tip_value), taxRateBps: Number(order.tax_rate_bps),
    });
    db.prepare('UPDATE promotions SET uses = MAX(0, uses - 1) WHERE id = ?').run(order.promotion_id);
    db.prepare(`
      UPDATE orders SET discount_type = 'none', discount_value = 0, discount_cents = 0, discount_reason = '',
        promotion_id = NULL, promotion_code = '', subtotal_cents = ?, tax_cents = ?, tip_cents = ?,
        total_cents = ?, updated_at = ? WHERE id = ?
    `).run(totals.subtotalCents, totals.taxCents, totals.tipCents, totals.totalCents + Number(order.delivery_fee_cents ?? 0), now.toISOString(), orderId);
    audit(db, staffId, 'order.promotion.remove', 'order', orderId, { code: order.promotion_code });
    return getPromotionOrder(db, orderId);
  });
}

// Evita un ciclo de importación con orders.js.
function getPromotionOrder(db, orderId) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}


function zonedParts(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { day: days[get('weekday')] ?? now.getUTCDay(), time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}` };
}

export function findActiveHappyHour(db, now = new Date(), timezone = process.env.APP_TIMEZONE || 'America/Costa_Rica') {
  const { day, time } = zonedParts(now, timezone);
  const rows = db.prepare("SELECT * FROM promotions WHERE active = 1 AND auto_apply = 1").all();
  for (const row of rows) {
    if (row.starts_at && new Date(row.starts_at).getTime() > now.getTime()) continue;
    if (row.ends_at && new Date(row.ends_at).getTime() < now.getTime()) continue;
    if (row.max_uses > 0 && row.uses >= row.max_uses) continue;
    const days = String(row.days_of_week ?? '').split(',').map((value) => value.trim()).filter(Boolean).map(Number);
    if (days.length > 0 && !days.includes(day)) continue;
    const start = row.start_time; const end = row.end_time;
    if (start && end) {
      const inRange = start <= end ? (time >= start && time <= end) : (time >= start || time <= end);
      if (!inRange) continue;
    }
    return serializePromotion(row);
  }
  return null;
}
