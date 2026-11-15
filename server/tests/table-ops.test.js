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

async function openTable(tableId, productId = 1, key = 'line-table-01') {
  const created = await ctx.agent.post('/api/orders').send({ type: 'mesa', tableId });
  const order = created.body.order;
  await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({ items: [line(key, productId, 1)] });
  return order;
}

describe('mover y unir mesas', () => {
  it('mueve un pedido a una mesa libre y libera la anterior', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_table_transfer_merge: 'true' } });
    const order = await openTable(1);
    const moved = await ctx.agent.post(`/api/orders/${order.id}/move`).send({ tableId: 2 });
    expect(moved.status).toBe(200);
    expect(moved.body.order.tableId).toBe(2);
    expect(ctx.db.prepare('SELECT status FROM restaurant_tables WHERE id = 1').get().status).toBe('libre');
    expect(ctx.db.prepare('SELECT status FROM restaurant_tables WHERE id = 2').get().status).toBe('ocupada');
  });

  it('une dos pedidos conservando los productos y libera la mesa origen', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_table_transfer_merge: 'true' } });
    const target = await openTable(1, 1, 'line-target-01');
    const source = await openTable(2, 2, 'line-source-01');
    const merged = await ctx.agent.post(`/api/orders/${target.id}/merge`).send({ sourceOrderId: source.id });
    expect(merged.status).toBe(200);
    expect(merged.body.order.items).toHaveLength(2);
    expect(merged.body.order.tableId).toBe(1);
    expect(ctx.db.prepare('SELECT status FROM orders WHERE id = ?').get(source.id).status).toBe('anulada');
    expect(ctx.db.prepare('SELECT status FROM restaurant_tables WHERE id = 2').get().status).toBe('libre');
    expect(merged.body.order.totalCents).toBeGreaterThan(0);
  });

  it('requiere la función activa', async () => {
    const order = await openTable(1);
    const response = await ctx.agent.post(`/api/orders/${order.id}/move`).send({ tableId: 2 });
    expect(response.status).toBe(404);
  });
});
