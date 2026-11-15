import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hashPin } from '../src/auth.js';
import { makeContext, line } from './helpers.js';

let ctx;
let owner;
beforeEach(async () => {
  ctx = await makeContext();
  const now = new Date().toISOString();
  const result = ctx.db.prepare("INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at) VALUES ('Owner', 'owner', ?, 1, ?, ?)").run(hashPin('468135'), now, now);
  owner = request.agent(ctx.app);
  await owner.post('/api/auth/login').send({ staffId: Number(result.lastInsertRowid), pin: '468135' });
  await owner.patch('/api/settings').send({ settings: { feature_split_bill: 'true' } });
});
afterEach(() => { ctx.db.close(); });

async function makeOrder(tipValue = 0) {
  const created = await owner.post('/api/orders').send({ type: 'llevar' });
  const id = created.body.order.id;
  await owner.patch(`/api/orders/${id}/draft`).send({ items: [line('line-check-01', 1, 1)], tipType: tipValue ? 'fixed' : 'none', tipValue });
  return id;
}

describe('cuentas de facturación', () => {
  it('reparte el total exacto, cobra por cuenta y cierra al final', async () => {
    const id = await makeOrder(123);
    const before = await owner.get(`/api/orders/${id}`);
    const created = await owner.post(`/api/orders/${id}/checks/equal`).send({ count: 3 });
    expect(created.status).toBe(201);
    const checks = created.body.order.checks;
    expect(checks).toHaveLength(3);
    const sum = checks.reduce((total, check) => total + check.totalCents, 0);
    expect(sum).toBe(before.body.order.totalCents);
    const first = await owner.post(`/api/orders/${id}/checks/${checks[0].id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: checks[0].totalCents });
    expect(first.status).toBe(200);
    expect(first.body.order.status).toBe('abierta');
    expect(first.body.order.checks.find((check) => check.id === checks[0].id).status).toBe('paid');
    for (const check of checks.slice(1)) {
      const response = await owner.post(`/api/orders/${id}/checks/${check.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: check.totalCents });
      expect(response.status).toBe(200);
    }
    const closed = await owner.get(`/api/orders/${id}`);
    expect(closed.body.order.status).toBe('pagada');
    expect(closed.body.order.checks.every((check) => check.status === 'paid')).toBe(true);
  });

  it('bloquea mover líneas a una cuenta pagada y anular con cuentas pagadas', async () => {
    const id = await makeOrder();
    const created = await owner.post(`/api/orders/${id}/checks/equal`).send({ count: 2 });
    const [first, second] = created.body.order.checks;
    await owner.post(`/api/orders/${id}/checks/${first.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: first.totalCents });
    const lineId = created.body.order.items[0].id;
    const moved = await owner.post(`/api/orders/${id}/checks/${second.id}/move-line`).send({ fromCheckId: first.id, orderItemId: lineId, quantityMilli: 1000 });
    expect(moved.status).toBe(409);
    const cancelled = await owner.post(`/api/orders/${id}/cancel`).send({});
    expect(cancelled.status).toBe(409);
  });


  it('reparte descuento, impuesto y cantidades sin perder centavos', async () => {
    const created = await owner.post('/api/orders').send({ type: 'llevar' });
    const id = created.body.order.id;
    await owner.patch(`/api/orders/${id}/draft`).send({
      items: [line('line-check-disc-01', 5, 2), line('line-check-disc-02', 2, 1)],
      discountType: 'percent', discountValue: 1000, discountReason: 'Prueba', tipType: 'fixed', tipValue: 77,
    });
    const before = await owner.get(`/api/orders/${id}`);
    const split = await owner.post(`/api/orders/${id}/checks`).send({ groups: [
      { label: 'Ana', shares: [{ orderItemId: before.body.order.items[0].id, quantityMilli: 1000 }] },
      { label: 'Luis', shares: [{ orderItemId: before.body.order.items[0].id, quantityMilli: 1000 }, { orderItemId: before.body.order.items[1].id, quantityMilli: 1000 }] },
    ] });
    expect(split.status).toBe(201);
    const checks = split.body.order.checks;
    expect(checks.reduce((sum, check) => sum + check.totalCents, 0)).toBe(before.body.order.totalCents);
    const moved = await owner.post(`/api/orders/${id}/checks/${checks[1].id}/move-line`).send({ fromCheckId: checks[1].id, orderItemId: before.body.order.items[1].id, quantityMilli: 500 });
    expect(moved.status).toBe(200);
    const merged = await owner.post(`/api/orders/${id}/checks/merge`).send({ sourceCheckId: checks[1].id, targetCheckId: checks[0].id });
    expect(merged.status).toBe(200);
    expect(merged.body.order.checks).toHaveLength(1);
    const tip = await owner.patch(`/api/orders/${id}/checks/${merged.body.order.checks[0].id}/tip`).send({ tipType: 'fixed', tipValue: 100 });
    expect(tip.status).toBe(200);
    expect(tip.body.order.checks[0].tipCents).toBe(100);
    const audit = ctx.db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action LIKE 'order.checks.%'").get();
    expect(audit.count).toBeGreaterThan(0);
  });

  it('los pagos de las cuentas suman una sola vez en turno y reporte', async () => {
    const id = await makeOrder();
    const created = await owner.post(`/api/orders/${id}/checks/equal`).send({ count: 2 });
    const checks = created.body.order.checks;
    for (const check of checks) {
      await owner.post(`/api/orders/${id}/checks/${check.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: check.totalCents });
    }
    const shift = await owner.get('/api/shifts/current');
    expect(shift.body.totals.paymentCount).toBe(2);
    expect(shift.body.totals.orderCount).toBe(1);
    const closedOrder = await owner.get(`/api/orders/${id}`);
    const report = await owner.get(`/api/reports/daily?date=${closedOrder.body.order.businessDate}`);
    expect(report.status).toBe(200);
    expect(report.body.orderCount).toBeGreaterThanOrEqual(1);
  });


  it('conserva ids de líneas y envía solo la diferencia a cocina', async () => {
    const id = await makeOrder();
    const before = await owner.get(`/api/orders/${id}`);
    const itemId = before.body.order.items[0].id;
    await owner.post(`/api/orders/${id}/send-kitchen`).send({});
    await owner.patch(`/api/orders/${id}/draft`).send({ items: [line('line-check-01', 1, 3)] });
    const after = await owner.get(`/api/orders/${id}`);
    expect(after.body.order.items[0].id).toBe(itemId);
    const sent = await owner.post(`/api/orders/${id}/send-kitchen`).send({});
    expect(sent.status).toBe(200);
    const audit = ctx.db.prepare("SELECT details FROM audit_logs WHERE action = 'order.send_kitchen' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(id);
    expect(JSON.parse(audit.details).itemCount).toBe(2);
  });

  it('un pedido sin cuentas se comporta como antes', async () => {
    const id = await makeOrder();
    const paid = await owner.post(`/api/orders/${id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: 50000 });
    expect(paid.status).toBe(200);
    expect(paid.body.order.checks).toEqual([]);
  });
});
