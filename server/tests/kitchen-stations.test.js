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

describe('estaciones de cocina', () => {
  it('requiere la función activa', async () => {
    const response = await ctx.agent.get('/api/kitchen/stations');
    expect(response.status).toBe(404);
  });

  it('asigna estación a un producto y filtra el KDS por estación', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_kitchen_stations: 'true' } });
    const stations = await ctx.agent.get('/api/kitchen/stations');
    expect(stations.status).toBe(200);
    const bar = stations.body.stations.find((station) => station.name === 'Barra');
    const kitchen = stations.body.stations.find((station) => station.name === 'Cocina');
    expect(bar).toBeTruthy();

    const product = await ctx.agent.patch('/api/admin/products/1').send({ stationId: bar.id, prepSeconds: 300 });
    expect(product.status).toBe(200);
    expect(product.body.product.stationId).toBe(bar.id);
    expect(product.body.product.prepSeconds).toBe(300);

    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    const order = created.body.order;
    await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({ items: [line('line-station-01', 1, 1)] });
    const sent = await ctx.agent.post(`/api/orders/${order.id}/send-kitchen`).send({});
    expect(sent.body.order.items[0].stationId).toBeUndefined(); // serialización de pedido no expone station
    const barTickets = await ctx.agent.get(`/api/kitchen/orders?stationId=${bar.id}`);
    expect(barTickets.body.tickets).toHaveLength(1);
    expect(barTickets.body.tickets[0].items[0].stationId).toBe(bar.id);
    expect(barTickets.body.tickets[0].items[0].targetAt).toBeTruthy();
    const kitchenTickets = await ctx.agent.get(`/api/kitchen/orders?stationId=${kitchen.id}`);
    expect(kitchenTickets.body.tickets).toHaveLength(0);
  });

  it('marca agotado un producto sin stock cuando la función está activa', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_inventory_sold_out: 'true' } });
    const item = await ctx.agent.post('/api/inventory/items').send({ name: 'Ingrediente agotado', unit: 'pz' });
    await ctx.agent.post(`/api/inventory/items/${item.body.item.id}/receipts`).send({ quantity: 1 });
    await ctx.agent.put('/api/inventory/recipes/1').send({ ingredients: [{ inventoryItemId: item.body.item.id, quantity: 2 }] });
    const catalog = await ctx.agent.get('/api/catalog');
    const product = catalog.body.categories.flatMap((category) => category.products).find((entry) => entry.id === 1);
    expect(product.soldOut).toBe(true);
    const created = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    const response = await ctx.agent.patch(`/api/orders/${created.body.order.id}/draft`).send({ items: [line('line-soldout-01', 1, 1)] });
    expect(response.status).toBe(422);
  });

  it('permite administrar estaciones desde el panel', async () => {
    await owner.patch('/api/settings').send({ settings: { feature_kitchen_stations: 'true' } });
    const created = await ctx.agent.post('/api/admin/kitchen-stations').send({ name: 'Parrilla', color: '#aa3300', sortOrder: 5 });
    expect(created.status).toBe(201);
    const updated = await ctx.agent.patch(`/api/admin/kitchen-stations/${created.body.station.id}`).send({ active: false });
    expect(updated.status).toBe(200);
    expect(updated.body.station.active).toBe(false);
  });
});
