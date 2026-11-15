import { conflict, notFound, validationError } from './errors.js';
import { getBooleanSetting } from './settings.js';

function serializeShift(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    openedByStaffId: Number(row.opened_by_staff_id),
    openedByName: row.opened_by_name ?? null,
    closedByStaffId: row.closed_by_staff_id === null ? null : Number(row.closed_by_staff_id),
    closedByName: row.closed_by_name ?? null,
    openingCents: Number(row.opening_cents),
    countedCents: row.counted_cents === null ? null : Number(row.counted_cents),
    expectedCents: Number(row.expected_cents),
    differenceCents: row.difference_cents === null ? null : Number(row.difference_cents),
    status: row.status,
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    notes: row.notes,
  };
}

export function getOpenShift(db) {
  return db
    .prepare(`
      SELECT s.*, opener.name AS opened_by_name, closer.name AS closed_by_name
      FROM shifts s
      JOIN staff opener ON opener.id = s.opened_by_staff_id
      LEFT JOIN staff closer ON closer.id = s.closed_by_staff_id
      WHERE s.status = 'open'
      LIMIT 1
    `)
    .get();
}

export function getShiftSummary(db, shiftId) {
  const shift = db
    .prepare(`
      SELECT s.*, opener.name AS opened_by_name, closer.name AS closed_by_name
      FROM shifts s
      JOIN staff opener ON opener.id = s.opened_by_staff_id
      LEFT JOIN staff closer ON closer.id = s.closed_by_staff_id
      WHERE s.id = ?
    `)
    .get(shiftId);
  if (!shift) throw notFound('No se encontró el turno.');
  const totals = db
    .prepare(`
      SELECT payment_method, method_name, method_kind,
             COUNT(*) AS payment_count, COALESCE(SUM(amount_cents), 0) AS total_cents
      FROM payments
      WHERE shift_id = ?
      GROUP BY payment_method, method_name, method_kind
      ORDER BY MIN(id)
    `)
    .all(shiftId);
  const methods = { efectivo: 0, tarjeta: 0, otro: 0 };
  const counts = { efectivo: 0, tarjeta: 0, otro: 0 };
  const methodBreakdown = [];
  let cashSalesCents = 0;
  for (const row of totals) {
    const total = Number(row.total_cents);
    const count = Number(row.payment_count);
    if (row.method_kind === 'cash') {
      methods.efectivo += total;
      counts.efectivo += count;
      cashSalesCents += total;
    } else if (row.method_kind === 'card') {
      methods.tarjeta += total;
      counts.tarjeta += count;
    } else {
      methods.otro += total;
      counts.otro += count;
    }
    methodBreakdown.push({
      code: row.payment_method,
      name: row.method_name || row.payment_method,
      kind: row.method_kind || 'other',
      totalCents: total,
      paymentCount: count,
    });
  }
  const orderCount = Number(
    db.prepare('SELECT COUNT(DISTINCT order_id) AS count FROM payments WHERE shift_id = ?').get(shiftId).count,
  );
  const tipsCents = Number(
    db.prepare('SELECT COALESCE(SUM(tip_cents), 0) AS tip FROM orders WHERE shift_id = ? AND status = ?')
      .get(shiftId, 'pagada').tip,
  );
  const refunds = db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total, COALESCE(SUM(cash_cents), 0) AS cash FROM refunds WHERE shift_id = ?")
    .get(shiftId);
  const refundCents = Number(refunds.total);
  const cashRefundCents = Number(refunds.cash);
  const expectedCents = Number(shift.opening_cents) + cashSalesCents - cashRefundCents;
  return {
    shift: serializeShift(shift),
    totals: {
      ...methods,
      methods: methodBreakdown,
      orderCount,
      paymentCount: counts.efectivo + counts.tarjeta + counts.otro,
      tipsCents,
      refundCents,
      cashRefundCents,
      expectedCents,
      cashSalesCents,
    },
  };
}

export function openShift(db, staffId, openingCents, notes = '', now = new Date().toISOString()) {
  if (getOpenShift(db)) throw conflict('Ya hay un turno de caja abierto.');
  if (!Number.isInteger(openingCents) || openingCents < 0) {
    throw validationError('El fondo inicial no es válido.');
  }
  const result = db
    .prepare(`
      INSERT INTO shifts
        (opened_by_staff_id, opening_cents, status, opened_at, notes)
      VALUES (?, ?, 'open', ?, ?)
    `)
    .run(staffId, openingCents, now, notes);
  return getShiftSummary(db, Number(result.lastInsertRowid));
}

export function closeShift(db, shiftId, staffId, countedCents, notes = '', now = new Date().toISOString()) {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId);
  if (!shift) throw notFound('No se encontró el turno.');
  if (shift.status !== 'open') throw conflict('El turno ya está cerrado.');
  if (!Number.isInteger(countedCents) || countedCents < 0) {
    throw validationError('El efectivo contado no es válido.');
  }
  const summary = getShiftSummary(db, shiftId);
  const expected = summary.totals.expectedCents;
  const difference = countedCents - expected;
  db.prepare(`
    UPDATE shifts SET
      closed_by_staff_id = ?, counted_cents = ?, expected_cents = ?, difference_cents = ?,
      status = 'closed', closed_at = ?, notes = CASE WHEN ? = '' THEN notes ELSE ? END
    WHERE id = ?
  `).run(staffId, countedCents, expected, difference, now, notes, notes, shiftId);
  return getShiftSummary(db, shiftId);
}

export function requireOpenShiftForPayment(db) {
  const required = getBooleanSetting(db, 'require_shift', true);
  const shift = getOpenShift(db);
  if (required && !shift) {
    throw conflict('Abre un turno de caja antes de cobrar.', { code: 'SHIFT_CLOSED' });
  }
  return shift;
}
