import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDatabase, migrate, seedDatabase, seedOperationalData } from '../src/db.js';
import { hashPin } from '../src/auth.js';

export async function makeContext() {
  const config = {
    port: 0,
    databasePath: ':memory:',
    timezone: 'America/Mexico_City',
    currency: 'MXN',
    taxRateBps: 1600,
    sessionTtlHours: 12,
    cookieSecure: false,
  };
  const db = openDatabase(':memory:');
  migrate(db);
  seedDatabase(db, { now: '2026-01-01T12:00:00.000Z' });
  seedOperationalData(db);
  const now = '2026-01-01T12:00:00.000Z';
  const inserted = db
    .prepare(`
      INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at)
      VALUES ('Admin Test', 'admin', ?, 1, ?, ?)
    `)
    .run(hashPin('1234'), now, now);
  const staffId = Number(inserted.lastInsertRowid);
  db.prepare(`
    INSERT INTO shifts (opened_by_staff_id, opening_cents, status, opened_at)
    VALUES (?, 0, 'open', ?)
  `).run(staffId, now);
  const app = createApp({ db, config });
  const agent = request.agent(app);
  const login = await agent
    .post('/api/auth/login')
    .send({ staffId, pin: '1234' });
  if (login.status !== 200) {
    throw new Error(`No se pudo autenticar el contexto de pruebas: ${login.text}`);
  }
  return { db, app, config, agent, staffId };
}

export async function createOrder(agent, payload) {
  return agent.post('/api/orders').send(payload);
}

export function line(clientKey, productId, quantity = 1, notes = '') {
  return { clientKey, productId, quantity, notes };
}
