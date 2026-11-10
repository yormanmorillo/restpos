import request from 'supertest';
import { createApp } from '../src/app.js';
import { openDatabase, migrate, seedDatabase } from '../src/db.js';

export function makeContext() {
  const config = {
    port: 0,
    databasePath: ':memory:',
    timezone: 'America/Mexico_City',
    currency: 'MXN',
    taxRateBps: 1600,
  };
  const db = openDatabase(':memory:');
  migrate(db);
  seedDatabase(db, { now: '2026-01-01T12:00:00.000Z' });
  const app = createApp({ db, config });
  return { db, app, config };
}

export async function createOrder(app, payload) {
  const response = await request(app).post('/api/orders').send(payload);
  return response;
}

export function line(clientKey, productId, quantity = 1, notes = '') {
  return { clientKey, productId, quantity, notes };
}
