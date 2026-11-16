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

describe('cupones', () => {
  it('requiere la función activa', async () => {
    expect((await ctx.agent.get('/api/promotions')).status).toBe(404);
  });

  it('aplica y quita un cupón con mínimo y usos', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_promotions: 'true' } });
    const promo = await ctx.agent.post('/api/promotions').send({ code: 'BIENVENIDO10', name: 'Bienvenida', type: 'percent', value: 1000, minSubtotalCents: 5000, maxUses: 2 });
    expect(promo.status).toBe(201);
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    const order = created.body.order;
    await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({ items: [line('line-promo-01', 1, 1)] });
    const applied = await ctx.agent.post(`/api/orders/${order.id}/promotion`).send({ code: 'BIENVENIDO10' });
    expect(applied.status).toBe(200);
    expect(applied.body.order.promotionCode).toBe('BIENVENIDO10');
    expect(applied.body.order.discountCents).toBeGreaterThan(0);
    expect((await ctx.agent.get('/api/promotions')).body.promotions[0].uses).toBe(1);
    const removed = await ctx.agent.delete(`/api/orders/${order.id}/promotion`);
    expect(removed.status).toBe(200);
    expect(removed.body.order.promotionCode).toBe('');
    expect((await ctx.agent.get('/api/promotions')).body.promotions[0].uses).toBe(0);
  });

  it('rechaza cupones vencidos o con mínimo no alcanzado', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_promotions: 'true' } });
    await ctx.agent.post('/api/promotions').send({ code: 'CARO', name: 'Caro', type: 'fixed', value: 1000, minSubtotalCents: 999999 });
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    await ctx.agent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line('line-promo-02', 1, 1)] });
    const response = await ctx.agent.post(`/api/orders/${created.body.order.id}/promotion`).send({ code: 'CARO' });
    expect(response.status).toBe(409);
  });

  it('libera el uso del cupón al cancelar el pedido', async () => {
    ctx.db.prepare("UPDATE settings SET value = 'true' WHERE key = 'feature_promotions'").run();
    await owner.post('/api/promotions').send({ code: 'UNUSO', name: 'Un uso', type: 'fixed', value: 100, maxUses: 1 });
    const created = await owner.post('/api/orders').send({ type: 'llevar' });
    const id = created.body.order.id;
    await owner.patch(`/api/orders/${id}/draft`).send({ items: [line('line-promo-cancel', 1, 1)] });
    expect((await owner.post(`/api/orders/${id}/promotion`).send({ code: 'UNUSO' })).status).toBe(200);
    expect((await owner.post(`/api/orders/${id}/cancel`).send({})).status).toBe(200);
    const second = await owner.post('/api/orders').send({ type: 'llevar' });
    await owner.patch(`/api/orders/${second.body.order.id}/draft`).send({ items: [line('line-promo-cancel-2', 1, 1)] });
    expect((await owner.post(`/api/orders/${second.body.order.id}/promotion`).send({ code: 'UNUSO' })).status).toBe(200);
  });

});
