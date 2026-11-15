import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hashPin } from '../src/auth.js';
import { makeContext, line } from './helpers.js';

let ctx;
let owner;

beforeEach(async () => {
  ctx = await makeContext();
  const now = new Date().toISOString();
  const result = ctx.db.prepare("INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at) VALUES ('Owner', 'owner', ?, 1, ?, ?)")
    .run(hashPin('468135'), now, now);
  owner = request.agent(ctx.app);
  await owner.post('/api/auth/login').send({ staffId: Number(result.lastInsertRowid), pin: '468135' });
});

afterEach(() => { ctx.db.close(); });

async function paidOrder(method = 'tarjeta') {
  const orderResponse = await ctx.agent.post('/api/orders').send({ type: 'mesa', tableId: 1 });
  const order = orderResponse.body.order;
  await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({ items: [line('line-refund-01', 1, 1)] });
  const paid = await ctx.agent.post(`/api/orders/${order.id}/pay`).send({ paymentMethod: method, ...(method === 'efectivo' ? { cashReceivedCents: 50000 } : {}) });
  expect(paid.status).toBe(200);
  return paid.body.order;
}

describe('reembolsos', () => {
  it('requiere que la función esté activa', async () => {
    const order = await paidOrder();
    const denied = await ctx.agent.post(`/api/orders/${order.id}/refund`).send({ reason: 'Prueba', managerPin: '246813' });
    expect(denied.status).toBe(404);
  });

  it('permite reembolsos parciales y cierra el saldo con otro reembolso', async () => {
    const manager = await ctx.agent.post('/api/staff').send({ name: 'Gerente Parcial', role: 'manager', pin: '246813' });
    expect(manager.status).toBe(201);
    await owner.patch('/api/settings').send({ settings: { feature_refunds: 'true' } });
    const order = await paidOrder();
    const partial = await ctx.agent.post(`/api/orders/${order.id}/refund`).send({ reason: 'Parte del servicio', managerPin: '246813', amountCents: 1000 });
    expect(partial.status).toBe(200);
    expect(partial.body.order.refundedAt).toBeNull();
    expect(partial.body.order.refundCents).toBe(1000);
    const stillOpen = await ctx.agent.get('/api/reports/daily');
    expect(stillOpen.body.orderCount).toBe(1);
    expect(stillOpen.body.refundCents).toBe(1000);
    const rest = await ctx.agent.post(`/api/orders/${order.id}/refund`).send({ reason: 'Resto del servicio', managerPin: '246813' });
    expect(rest.status).toBe(200);
    expect(rest.body.order.refundedAt).toBeTruthy();
    const finalReport = await ctx.agent.get('/api/reports/daily');
    expect(finalReport.body.orderCount).toBe(0);
  });

  it('exige PIN de gerente, motivo y revierte inventario y reporte', async () => {
    const manager = await ctx.agent.post('/api/staff').send({ name: 'Gerente Reembolso', role: 'manager', pin: '246813' });
    expect(manager.status).toBe(201);
    await owner.patch('/api/settings').send({ settings: { feature_refunds: 'true' } });

    const item = await ctx.agent.post('/api/inventory/items').send({ name: 'Pan refund', unit: 'pz' });
    await ctx.agent.post(`/api/inventory/items/${item.body.item.id}/receipts`).send({ quantity: 10 });
    await ctx.agent.put('/api/inventory/recipes/1').send({ ingredients: [{ inventoryItemId: item.body.item.id, quantity: 2 }] });
    const order = await paidOrder();
    const afterSale = await ctx.agent.get('/api/inventory/items');
    expect(afterSale.body.items[0].currentQuantity).toBe(8);

    const badPin = await ctx.agent.post(`/api/orders/${order.id}/refund`).send({ reason: 'Cargo duplicado', managerPin: '111111' });
    expect(badPin.status).toBe(403);
    const missingReason = await ctx.agent.post(`/api/orders/${order.id}/refund`).send({ managerPin: '246813', reason: 'x' });
    expect(missingReason.status).toBe(422);
    const refund = await ctx.agent.post(`/api/orders/${order.id}/refund`).send({ reason: 'Cargo duplicado', managerPin: '246813' });
    expect(refund.status).toBe(200);
    expect(refund.body.order.refundedAt).toBeTruthy();
    expect(refund.body.order.refundCents).toBe(order.totalCents);
    const afterRefund = await ctx.agent.get('/api/inventory/items');
    expect(afterRefund.body.items[0].currentQuantity).toBe(10);

    const report = await ctx.agent.get('/api/reports/daily');
    expect(report.body.orderCount).toBe(0);
    const audit = ctx.db.prepare("SELECT details FROM audit_logs WHERE action = 'order.refund' ORDER BY id DESC LIMIT 1").get();
    expect(audit.details).toContain('Cargo duplicado');
    const duplicate = await ctx.agent.post(`/api/orders/${order.id}/refund`).send({ reason: 'Otra vez', managerPin: '246813' });
    expect(duplicate.status).toBe(409);
  });
});
