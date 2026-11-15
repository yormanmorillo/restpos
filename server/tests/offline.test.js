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

describe('ventas offline', () => {
  it('requiere la función activa', async () => {
    const response = await ctx.agent.post('/api/offline/sales').send({});
    expect(response.status).toBe(404);
  });

  it('sincroniza una venta de efectivo de forma idempotente', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_offline_mode: 'true' } });
    const payload = {
      operationId: 'offline-test-0001',
      occurredAt: new Date().toISOString(),
      customerName: 'Cliente offline',
      items: [{ productId: 1, quantity: 1, notes: '' }],
      cashReceivedCents: 20000,
    };
    const first = await ctx.agent.post('/api/offline/sales').send(payload);
    expect(first.status).toBe(201);
    expect(first.body.order.status).toBe('pagada');
    expect(first.body.order.source).toBe('offline');
    expect(first.body.order.paymentMethod).toBe('efectivo');
    const count = ctx.db.prepare('SELECT COUNT(*) AS count FROM orders WHERE source = ?').get('offline').count;
    expect(count).toBe(1);
    const retry = await ctx.agent.post('/api/offline/sales').send(payload);
    expect(retry.status).toBe(201);
    expect(retry.body.order.id).toBe(first.body.order.id);
    expect(ctx.db.prepare('SELECT COUNT(*) AS count FROM orders WHERE source = ?').get('offline').count).toBe(1);
  });
});
