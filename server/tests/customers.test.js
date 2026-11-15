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

describe('clientes y fidelidad', () => {
  it('requiere la función activa', async () => {
    expect((await ctx.agent.get('/api/customers')).status).toBe(404);
  });

  it('asigna cliente, acumula puntos y conserva historial', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_customers_loyalty: 'true' } });
    const createdCustomer = await ctx.agent.post('/api/customers').send({ name: 'Ana Pérez', phone: '88881111' });
    expect(createdCustomer.status).toBe(201);
    const customer = createdCustomer.body.customer;

    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar', customerId: customer.id, customerName: customer.name });
    const order = created.body.order;
    await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({ items: [line('line-customer-01', 1, 1)] });
    const paid = await ctx.agent.post(`/api/orders/${order.id}/pay`).send({ paymentMethod: 'tarjeta' });
    expect(paid.status).toBe(200);
    const after = await ctx.agent.get(`/api/customers/${customer.id}`);
    expect(after.status).toBe(200);
    expect(after.body.customer.pointsBalance).toBeGreaterThan(0);
    expect(after.body.customer.visits).toBe(1);
    expect(after.body.customer.orders[0].id).toBe(order.id);
    expect(paid.body.order.customerId).toBe(customer.id);
  });

  it('revierte los puntos en un reembolso total', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_customers_loyalty: 'true', feature_refunds: 'true' } });
    const customer = (await ctx.agent.post('/api/customers').send({ name: 'Luis', phone: '77776666' })).body.customer;
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar', customerId: customer.id });
    await ctx.agent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line('line-customer-02', 1, 1)] });
    await ctx.agent.post(`/api/orders/${created.body.order.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: 20000 });
    const before = await ctx.agent.get(`/api/customers/${customer.id}`);
    expect(before.body.customer.pointsBalance).toBeGreaterThan(0);
    const manager = await ctx.agent.post('/api/staff').send({ name: 'Gerente', role: 'manager', pin: '246813' });
    expect(manager.status).toBe(201);
    const refund = await ctx.agent.post(`/api/orders/${created.body.order.id}/refund`).send({ reason: 'Prueba', managerPin: '246813' });
    expect(refund.status).toBe(200);
    const after = await ctx.agent.get(`/api/customers/${customer.id}`);
    expect(after.body.customer.pointsBalance).toBe(0);
  });
});
