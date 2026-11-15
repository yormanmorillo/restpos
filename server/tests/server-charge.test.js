import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hashPin } from '../src/auth.js';
import { makeContext, line } from './helpers.js';

let ctx;
let serverAgent;
let cashierAgent;
let managerAgent;

function addStaff(role, pin) {
  const now = new Date().toISOString();
  const result = ctx.db.prepare("INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)")
    .run(`Test ${role}`, role, hashPin(pin), now, now);
  return { id: Number(result.lastInsertRowid), pin };
}

async function login(staff) {
  const agent = request.agent(ctx.app);
  const response = await agent.post('/api/auth/login').send({ staffId: staff.id, pin: staff.pin });
  expect(response.status).toBe(200);
  return agent;
}

beforeEach(async () => {
  ctx = await makeContext();
  serverAgent = await login(addStaff('server', '135791'));
  cashierAgent = await login(addStaff('cashier', '246802'));
  managerAgent = await login(addStaff('manager', '357913'));
});

afterEach(() => { ctx.db.close(); });

describe('permiso de cobro del mesero', () => {
  it('el mesero cobra cuando el ajuste está activo', async () => {
    const created = await serverAgent.post('/api/orders').send({ type: 'llevar' });
    await serverAgent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line('line-sc-01', 1, 1)] });
    const paid = await serverAgent.post(`/api/orders/${created.body.order.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: 50000 });
    expect(paid.status).toBe(200);
    expect(paid.body.order.status).toBe('pagada');
  });

  it('bloquea al mesero cuando el ajuste está inactivo y el pedido sigue sin pagos', async () => {
    await ctx.agent.patch('/api/settings').send({ settings: { server_can_charge: 'false' } });
    const created = await serverAgent.post('/api/orders').send({ type: 'llevar' });
    await serverAgent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line('line-sc-02', 1, 1)] });
    const blocked = await serverAgent.post(`/api/orders/${created.body.order.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: 50000 });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.message).toContain('Los meseros no pueden cobrar');
    const order = await cashierAgent.get(`/api/orders/${created.body.order.id}`);
    expect(order.body.order.amountPaidCents).toBe(0);
    expect(order.body.order.payments).toHaveLength(0);
  });


  it('el permiso también aplica al cobro de una cuenta dividida', async () => {
    ctx.db.prepare("UPDATE settings SET value = 'true' WHERE key = 'feature_split_bill'").run();
    await ctx.agent.patch('/api/settings').send({ settings: { server_can_charge: 'false' } });
    const created = await serverAgent.post('/api/orders').send({ type: 'llevar' });
    const id = created.body.order.id;
    await serverAgent.patch(`/api/orders/${id}/draft`).send({ items: [line('line-sc-split', 1, 2)] });
    const split = await serverAgent.post(`/api/orders/${id}/checks/equal`).send({ count: 2 });
    expect(split.status).toBe(201);
    const check = split.body.order.checks[0];
    const blocked = await serverAgent.post(`/api/orders/${id}/checks/${check.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: check.totalCents });
    expect(blocked.status).toBe(403);
    expect((await cashierAgent.get(`/api/orders/${id}`)).body.order.checks[0].amountPaidCents).toBe(0);
  });

  it('cajero y gerente cobran con el ajuste inactivo', async () => {
    await ctx.agent.patch('/api/settings').send({ settings: { server_can_charge: 'false' } });
    for (const [agent, key] of [[cashierAgent, 'line-sc-03'], [managerAgent, 'line-sc-04']]) {
      const created = await agent.post('/api/orders').send({ type: 'llevar' });
      await agent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line(key, 1, 1)] });
      const paid = await agent.post(`/api/orders/${created.body.order.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: 50000 });
      expect(paid.status).toBe(200);
    }
  });

  it('solo owner, admin y manager actualizan el ajuste', async () => {
    expect((await cashierAgent.patch('/api/settings').send({ settings: { server_can_charge: 'false' } })).status).toBe(403);
    expect((await serverAgent.patch('/api/settings').send({ settings: { server_can_charge: 'false' } })).status).toBe(403);
    expect((await managerAgent.patch('/api/settings').send({ settings: { server_can_charge: 'false' } })).status).toBe(200);
  });

  it('anular queda limitado a owner, admin y manager', async () => {
    for (const agent of [serverAgent, cashierAgent]) {
      const created = await agent.post('/api/orders').send({ type: 'llevar' });
      const response = await agent.post(`/api/orders/${created.body.order.id}/cancel`).send({});
      expect(response.status).toBe(403);
    }
    const created = await managerAgent.post('/api/orders').send({ type: 'llevar' });
    const cancelled = await managerAgent.post(`/api/orders/${created.body.order.id}/cancel`).send({});
    expect(cancelled.status).toBe(200);
  });
});
