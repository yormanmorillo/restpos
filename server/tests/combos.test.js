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

describe('combos', () => {
  it('crea un combo y consume inventario de sus componentes', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_combos: 'true' } });
    const item = await ctx.agent.post('/api/inventory/items').send({ name: 'Pan', unit: 'pz' });
    await ctx.agent.post(`/api/inventory/items/${item.body.item.id}/receipts`).send({ quantity: 10 });
    await ctx.agent.put('/api/inventory/recipes/1').send({ ingredients: [{ inventoryItemId: item.body.item.id, quantity: 1 }] });
    const combo = await ctx.agent.post('/api/admin/products').send({
      categoryId: 1, name: 'Combo pan', priceCents: 5000, isCombo: true, comboItems: [{ productId: 1, quantity: 2 }],
    });
    expect(combo.status).toBe(201);
    expect(combo.body.product.isCombo).toBe(true);
    expect(combo.body.product.comboItems[0].quantity).toBe(2);
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    await ctx.agent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line('line-combo-01', combo.body.product.id, 1)] });
    const paid = await ctx.agent.post(`/api/orders/${created.body.order.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: 20000 });
    expect(paid.status).toBe(200);
    const stock = ctx.db.prepare('SELECT current_milli FROM inventory_items WHERE id = ?').get(item.body.item.id);
    expect(stock.current_milli).toBe(8000);
  });
});
