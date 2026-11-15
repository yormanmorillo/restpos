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

describe('gift cards', () => {
  it('requiere la función activa', async () => {
    expect((await ctx.agent.get('/api/gift-cards')).status).toBe(404);
  });

  it('emite, cobra y descuenta saldo', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_gift_cards: 'true' } });
    const issued = await ctx.agent.post('/api/gift-cards').send({ amountCents: 20000, notes: 'Regalo' });
    expect(issued.status).toBe(201);
    const card = issued.body.giftCard;
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    const order = created.body.order;
    await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({ items: [line('line-gift-01', 1, 1)] });
    const paid = await ctx.agent.post(`/api/orders/${order.id}/pay`).send({ paymentMethod: 'gift_card', giftCardCode: card.code });
    expect(paid.status).toBe(200);
    expect(paid.body.order.status).toBe('pagada');
    const after = await ctx.agent.get(`/api/gift-cards/${card.code}`);
    expect(after.body.giftCard.balanceCents).toBe(20000 - paid.body.order.totalCents);
    const list = await ctx.agent.get('/api/gift-cards');
    expect(list.body.giftCards).toHaveLength(1);
  });

  it('rechaza una gift card sin saldo suficiente', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_gift_cards: 'true' } });
    const card = (await ctx.agent.post('/api/gift-cards').send({ amountCents: 100 })).body.giftCard;
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    await ctx.agent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line('line-gift-02', 1, 1)] });
    const paid = await ctx.agent.post(`/api/orders/${created.body.order.id}/pay`).send({ paymentMethod: 'gift_card', giftCardCode: card.code });
    expect(paid.status).toBe(409);
  });
});
