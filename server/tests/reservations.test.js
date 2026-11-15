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

describe('reservas y lista de espera', () => {
  it('requiere la función activa', async () => {
    expect((await ctx.agent.get('/api/reservations')).status).toBe(404);
  });

  it('gestiona reservas y lista de espera', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_reservations: 'true' } });
    const created = await ctx.agent.post('/api/reservations').send({ name: 'Ana', phone: '8888', partySize: 4, date: '2026-11-20', time: '19:30' });
    expect(created.status).toBe(201);
    const reservation = created.body.reservation;
    const list = await ctx.agent.get('/api/reservations?date=2026-11-20');
    expect(list.body.reservations).toHaveLength(1);
    const seated = await ctx.agent.patch(`/api/reservations/${reservation.id}`).send({ status: 'seated' });
    expect(seated.body.reservation.status).toBe('seated');

    const waiting = await ctx.agent.post('/api/waitlist').send({ name: 'Luis', phone: '7777', partySize: 2, quotedMinutes: 15 });
    expect(waiting.status).toBe(201);
    const waitList = await ctx.agent.get('/api/waitlist');
    expect(waitList.body.entries).toHaveLength(1);
    const waitSeated = await ctx.agent.patch(`/api/waitlist/${waiting.body.entry.id}`).send({ status: 'seated' });
    expect(waitSeated.body.entry.status).toBe('seated');
    expect((await ctx.agent.get('/api/waitlist')).body.entries).toHaveLength(0);
  });
});
