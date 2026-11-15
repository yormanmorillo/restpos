import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../src/db.js';
import { makeContext, line } from './helpers.js';

let ctx;
beforeEach(async () => { ctx = await makeContext(); });
afterEach(() => { ctx.db.close(); });

describe('migración de divisiones anteriores', () => {
  it('convierte order_splits en order_checks sin perder líneas ni pagos', async () => {
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    const id = created.body.order.id;
    await ctx.agent.patch(`/api/orders/${id}/draft`).send({ items: [line('legacy-line-01', 1, 1)] });
    const now = new Date().toISOString();
    const split = ctx.db.prepare("INSERT INTO order_splits (order_id, label, status, total_cents, created_at) VALUES (?, 'Parte vieja', 'open', 100, ?)").run(id, now);
    const splitId = Number(split.lastInsertRowid);
    ctx.db.prepare('UPDATE order_items SET split_id = ? WHERE order_id = ?').run(splitId, id);
    migrate(ctx.db);
    const check = ctx.db.prepare('SELECT * FROM order_checks WHERE legacy_split_id = ?').get(splitId);
    expect(check).toBeTruthy();
    expect(check.label).toBe('Parte vieja');
    const lineRow = ctx.db.prepare('SELECT * FROM order_check_lines WHERE check_id = ?').get(check.id);
    expect(lineRow.quantity_milli).toBe(1000);
    expect(ctx.db.prepare('SELECT check_id FROM order_items WHERE order_id = ?').get(id).check_id).toBe(check.id);
  });
});
