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

describe('canje de puntos y happy hour', () => {
  it('paga con puntos y descuenta el saldo', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_customers_loyalty: 'true', feature_loyalty_redemption: 'true' } });
    const customer = (await ctx.agent.post('/api/customers').send({ name: 'Puntos', phone: '70001111' })).body.customer;
    const seeded = ctx.db.prepare('UPDATE customers SET points_balance = 50 WHERE id = ?').run(customer.id);
    expect(seeded.changes).toBe(1);
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar', customerId: customer.id });
    await ctx.agent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line('line-a2-01', 1, 1)] });
    const paid = await ctx.agent.post(`/api/orders/${created.body.order.id}/pay`).send({ paymentMethod: 'puntos', amountCents: 100 });
    expect(paid.status).toBe(200);
    const after = await ctx.agent.get(`/api/customers/${customer.id}`);
    expect(after.body.customer.pointsBalance).toBe(40);
  });

  it('aplica happy hour automático al actualizar el pedido', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_happy_hour: 'true', feature_promotions: 'true' } });
    const promo = await ctx.agent.post('/api/promotions').send({ code: 'HAPPY20', name: 'Happy hour', type: 'percent', value: 2000, active: true, autoApply: true });
    expect(promo.status).toBe(201);
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    const updated = await ctx.agent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line('line-a2-02', 1, 1)] });
    expect(updated.status).toBe(200);
    expect(updated.body.order.promotionCode).toBe('HAPPY20');
    expect(updated.body.order.discountCents).toBeGreaterThan(0);
  });
});
