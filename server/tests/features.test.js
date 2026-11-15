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
  const login = await owner.post('/api/auth/login').send({ staffId: Number(result.lastInsertRowid), pin: '468135' });
  expect(login.status).toBe(200);
});

afterEach(() => { ctx.db.close(); });

describe('funciones activables', () => {
  it('mantiene activos los módulos existentes y apaga las funciones nuevas', async () => {
    const response = await owner.get('/api/features');
    expect(response.status).toBe(200);
    expect(response.body.features.flags.inventory).toBe(true);
    expect(response.body.features.flags.bulk_import).toBe(true);
    expect(response.body.features.flags.split_bill).toBe(false);
    expect(response.body.features.flags.qr_table_order).toBe(false);
  });

  it('permite al super admin activar una función nueva y desactivar un módulo', async () => {
    const enabled = await owner.patch('/api/settings').send({ settings: { feature_split_bill: 'true', feature_inventory: 'false' } });
    expect(enabled.status).toBe(200);
    const features = await owner.get('/api/features');
    expect(features.body.features.flags.split_bill).toBe(true);
    expect(features.body.features.flags.inventory).toBe(false);
    const inventory = await owner.get('/api/inventory/items');
    expect(inventory.status).toBe(404);
    const restored = await owner.patch('/api/settings').send({ settings: { feature_inventory: 'true' } });
    expect(restored.status).toBe(200);
    expect((await owner.get('/api/inventory/items')).status).toBe(200);
  });

  it('no permite al gerente general cambiar funciones ni las recibe en ajustes', async () => {
    const denied = await ctx.agent.patch('/api/settings').send({ settings: { feature_split_bill: 'true' } });
    expect(denied.status).toBe(200);
    const features = await ctx.agent.get('/api/features');
    expect(features.body.features.flags.split_bill).toBe(false);
    const settings = await ctx.agent.get('/api/settings');
    expect(settings.body.settings.feature_split_bill).toBeUndefined();
  });

  it('rechaza una bandera desconocida', async () => {
    const response = await owner.patch('/api/settings').send({ settings: { feature_no_existe: 'true' } });
    expect(response.status).toBe(422);
  });
});
