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

async function orderWithTwoItems() {
  const created = await ctx.agent.post('/api/orders').send({ type: 'mesa', tableId: 1 });
  const order = created.body.order;
  const draft = await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({
    items: [line('line-split-a', 1, 1), line('line-split-b', 2, 1)],
  });
  expect(draft.status).toBe(200);
  return draft.body.order;
}

describe('dividir cuenta', () => {
  it('está protegida por la función activable', async () => {
    const order = await orderWithTwoItems();
    const response = await ctx.agent.post(`/api/orders/${order.id}/splits`).send({ groups: [] });
    expect(response.status).toBe(404);
  });

  it('asigna productos a partes y cobra cada una de forma independiente', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_split_bill: 'true' } });
    const order = await orderWithTwoItems();
    const [first, second] = order.items;
    const splitResponse = await ctx.agent.post(`/api/orders/${order.id}/splits`).send({
      groups: [
        { label: 'Persona 1', itemIds: [first.id] },
        { label: 'Persona 2', itemIds: [second.id] },
      ],
    });
    expect(splitResponse.status).toBe(201);
    const splitOrder = splitResponse.body.order;
    expect(splitOrder.splits).toHaveLength(2);
    expect(splitOrder.splits.reduce((sum, split) => sum + split.totalCents, 0)).toBe(splitOrder.totalCents);

    const blocked = await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({ items: [line('line-split-a', 1, 2), line('line-split-b', 2, 1)] });
    expect(blocked.status).toBe(409);

    const firstPay = await ctx.agent.post(`/api/orders/${order.id}/pay`).send({ splitId: splitOrder.splits[0].id, paymentMethod: 'tarjeta' });
    expect(firstPay.status).toBe(200);
    expect(firstPay.body.order.status).toBe('abierta');
    expect(firstPay.body.order.splits[0].status).toBe('paid');

    const secondPay = await ctx.agent.post(`/api/orders/${order.id}/pay`).send({ splitId: firstPay.body.order.splits[1].id, paymentMethod: 'tarjeta' });
    expect(secondPay.status).toBe(200);
    expect(secondPay.body.order.status).toBe('pagada');
    expect(secondPay.body.order.splits.every((split) => split.status === 'paid')).toBe(true);
    const table = ctx.db.prepare('SELECT status FROM restaurant_tables WHERE id = 1').get();
    expect(table.status).toBe('libre');
  });

  it('rechaza dividir con descuento o propina', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_split_bill: 'true' } });
    const order = await orderWithTwoItems();
    await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({
      items: [line('line-split-a', 1, 1), line('line-split-b', 2, 1)],
      discountType: 'percent', discountValue: 1000, discountReason: 'Prueba',
    });
    const response = await ctx.agent.post(`/api/orders/${order.id}/splits`).send({
      groups: [{ label: 'A', itemIds: [order.items[0].id] }, { label: 'B', itemIds: [order.items[1].id] }],
    });
    expect(response.status).toBe(409);
  });
});
