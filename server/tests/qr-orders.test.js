import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hashPin } from '../src/auth.js';
import { makeContext } from './helpers.js';

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

describe('pedidos QR', () => {
  it('requiere la función activa', async () => {
    const table = ctx.db.prepare('SELECT qr_token FROM restaurant_tables LIMIT 1').get();
    expect((await ctx.agent.get(`/api/public/tables/${table.qr_token}`)).status).toBe(404);
  });


  it('rota el token QR e invalida el anterior', async () => {
    ctx.db.prepare("UPDATE settings SET value = 'true' WHERE key = 'feature_qr_table_order'").run();
    const table = ctx.db.prepare('SELECT id, qr_token FROM restaurant_tables LIMIT 1').get();
    const rotated = await ctx.agent.post(`/api/admin/tables/${table.id}/rotate-qr`).send({});
    expect(rotated.status).toBe(200);
    expect(rotated.body.table.qrToken).not.toBe(table.qr_token);
    expect((await ctx.agent.get(`/api/public/tables/${table.qr_token}`)).status).toBe(404);
    expect((await ctx.agent.get(`/api/public/tables/${rotated.body.table.qrToken}`)).status).toBe(200);
  });


  it('pide apoyo al mesero si la mesa tiene cuentas divididas', async () => {
    ctx.db.prepare("UPDATE settings SET value = 'true' WHERE key IN ('feature_qr_table_order', 'feature_split_bill')").run();
    const table = ctx.db.prepare('SELECT id, qr_token FROM restaurant_tables LIMIT 1').get();
    const created = await owner.post('/api/orders').send({ type: 'mesa', tableId: table.id });
    await owner.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [{ clientKey: 'qr-split-1', productId: 1, quantity: 2, notes: '' }] });
    const split = await owner.post(`/api/orders/${created.body.order.id}/checks/equal`).send({ count: 2 });
    expect(split.status).toBe(201);
    const response = await ctx.agent.post(`/api/public/tables/${table.qr_token}/orders`).send({ items: [{ productId: 1, quantity: 1 }] });
    expect(response.status).toBe(409);
    expect(response.body.error.message).toContain('Pide apoyo al mesero');
  });

  it('crea y amplía un pedido de mesa desde el QR', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_qr_table_order: 'true' } });
    const table = ctx.db.prepare('SELECT id, qr_token FROM restaurant_tables LIMIT 1').get();
    expect(table.qr_token).toBeTruthy();
    const menu = await ctx.agent.get(`/api/public/tables/${table.qr_token}`);
    expect(menu.status).toBe(200);
    expect(menu.body.table.id).toBe(table.id);
    const first = await ctx.agent.post(`/api/public/tables/${table.qr_token}/orders`).send({ customerName: 'Mesa 1', items: [{ productId: 1, quantity: 1 }] });
    expect(first.status).toBe(201);
    expect(first.body.order.status).toBe('abierta');
    const order = ctx.db.prepare('SELECT * FROM orders WHERE id = ?').get(first.body.order.id);
    expect(order.source).toBe('qr');
    expect(order.table_id).toBe(table.id);
    const second = await ctx.agent.post(`/api/public/tables/${table.qr_token}/orders`).send({ items: [{ productId: 2, quantity: 1 }] });
    expect(second.status).toBe(201);
    expect(second.body.order.id).toBe(first.body.order.id);
    expect(ctx.db.prepare('SELECT COUNT(*) AS c FROM order_items WHERE order_id = ?').get(first.body.order.id).c).toBe(2);
    expect(ctx.db.prepare("SELECT COUNT(*) AS c FROM order_items WHERE order_id = ? AND status = 'pending'").get(first.body.order.id).c).toBe(2);
    expect((await ctx.agent.post(`/api/orders/${first.body.order.id}/send-kitchen`).send({})).status).toBe(200);
  });
});
