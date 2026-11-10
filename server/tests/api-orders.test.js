import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeContext, createOrder, line } from './helpers.js';
import { businessDateFor } from '../src/business-date.js';

let ctx;

beforeEach(async () => {
  ctx = await makeContext();
});

afterEach(() => {
  ctx.db.close();
});

async function openTableOrder(tableId = 1, payload = {}) {
  const response = await createOrder(ctx.agent, { type: 'mesa', tableId, ...payload });
  expect(response.status).toBe(201);
  return response.body.order;
}

async function addGuacamole(orderId, quantity = 2, extra = {}) {
  return ctx.agent
    .patch(`/api/orders/${orderId}/draft`)
    .send({
      items: [line('line-000001', 1, quantity, 'Sin cebolla')],
      ...extra,
    });
}

describe('validación de entradas', () => {
  it('rechaza pedidos sin tipo o con mesa faltante', async () => {
    let response = await ctx.agent.post('/api/orders').send({ tableId: 1 });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');

    response = await ctx.agent.post('/api/orders').send({ type: 'mesa' });
    expect(response.status).toBe(422);
    expect(response.body.error.details.fields.some((f) => f.path === 'tableId')).toBe(true);
  });

  it('rechaza mesa en pedidos para llevar y mesas inexistentes', async () => {
    let response = await createOrder(ctx.agent, { type: 'llevar', tableId: 2 });
    expect(response.status).toBe(422);

    response = await createOrder(ctx.agent, { type: 'mesa', tableId: 999 });
    expect(response.status).toBe(404);
  });

  it('rechaza cantidades fuera de rango y claves duplicadas', async () => {
    const order = await openTableOrder(1);
    let response = await ctx.agent
      .patch(`/api/orders/${order.id}/draft`)
      .send({ items: [line('line-000001', 1, 0)] });
    expect(response.status).toBe(422);

    response = await ctx.agent
      .patch(`/api/orders/${order.id}/draft`)
      .send({ items: [line('line-000001', 1, 1), line('line-000001', 2, 1)] });
    expect(response.status).toBe(422);
    expect(response.body.error.details.fields.some((f) => f.path.includes('clientKey'))).toBe(true);
  });

  it('rechaza porcentajes mayores a 100 y métodos de pago inválidos', async () => {
    const order = await openTableOrder(1);
    let response = await ctx.agent
      .patch(`/api/orders/${order.id}/draft`)
      .send({ items: [line('line-000001', 1)], discountType: 'percent', discountValue: 10001 });
    expect(response.status).toBe(422);

    response = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'bitcoin' });
    expect(response.status).toBe(422);
  });

  it('responde 400 ante JSON inválido y 404 ante rutas inexistentes', async () => {
    const invalidJson = await ctx.agent
      .post('/api/orders')
      .set('Content-Type', 'application/json')
      .send('{"type":');
    expect(invalidJson.status).toBe(400);
    expect(invalidJson.body.error.code).toBe('INVALID_JSON');

    const missing = await ctx.agent.get('/api/no-existe');
    expect(missing.status).toBe(404);
  });

  it('rechaza cobrar un pedido vacío y efectivo insuficiente', async () => {
    const order = await openTableOrder(2);
    let response = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'efectivo', cashReceivedCents: 0 });
    expect(response.status).toBe(422);

    await addGuacamole(order.id, 1);
    response = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'efectivo', cashReceivedCents: 100 });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(response.body.error.details.missingCents).toBeGreaterThan(0);

    const stillOpen = await ctx.agent.get(`/api/tables`);
    expect(stillOpen.body.tables.find((t) => t.id === 2).status).toBe('ocupada');
  });
});

describe('mesas y estados de pedidos', () => {
  it('ocupa la mesa al crear el pedido y evita dos pedidos abiertos', async () => {
    const order = await openTableOrder(1);
    expect(order.status).toBe('abierta');
    expect(order.tableName).toBe('Mesa 1');
    expect(order.orderNumber).toMatch(/^P-\d{5}$/);

    const tables = await ctx.agent.get('/api/tables');
    const table = tables.body.tables.find((item) => item.id === 1);
    expect(table.status).toBe('ocupada');
    expect(table.openOrder.id).toBe(order.id);

    const duplicate = await createOrder(ctx.agent, { type: 'mesa', tableId: 1 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.details.orderId).toBe(order.id);
  });

  it('guarda productos, notas y totales autoritativos', async () => {
    const order = await openTableOrder(1);
    const response = await addGuacamole(order.id, 2, {
      discountType: 'percent',
      discountValue: 1000,
      tipType: 'percent',
      tipValue: 1500,
    });
    expect(response.status).toBe(200);
    const updated = response.body.order;
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0]).toMatchObject({
      productName: 'Guacamole con totopos',
      quantity: 2,
      notes: 'Sin cebolla',
      unitPriceCents: 8900,
      lineTotalCents: 17800,
    });
    expect(updated.subtotalCents).toBe(17800);
    expect(updated.discountCents).toBe(1780);
    expect(updated.taxCents).toBe(2563);
    expect(updated.tipCents).toBe(2787);
    expect(updated.totalCents).toBe(21370);
  });

  it('ignora totales manipulados por el cliente y recalcula en el servidor', async () => {
    const order = await openTableOrder(1);
    const response = await ctx.agent
      .patch(`/api/orders/${order.id}/draft`)
      .send({
        items: [line('line-000001', 1, 1)],
        totalCents: 1,
        subtotalCents: 1,
        taxCents: 0,
      });
    expect(response.status).toBe(200);
    expect(response.body.order.totalCents).toBe(10324);
  });

  it('cobra en efectivo, calcula cambio, libera la mesa y bloquea cambios', async () => {
    const order = await openTableOrder(1);
    await addGuacamole(order.id, 2, {
      discountType: 'percent',
      discountValue: 1000,
      tipType: 'percent',
      tipValue: 1500,
    });

    const paidResponse = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'efectivo', cashReceivedCents: 30000 });
    expect(paidResponse.status).toBe(200);
    const paid = paidResponse.body.order;
    expect(paid.status).toBe('pagada');
    expect(paid.paymentMethod).toBe('efectivo');
    expect(paid.cashReceivedCents).toBe(30000);
    expect(paid.changeCents).toBe(8630);
    expect(paid.totalCents).toBe(21370);
    expect(paid.paidAt).toBeTruthy();
    expect(paid.businessDate).toBe(businessDateFor(new Date(), ctx.config.timezone));

    const tables = await ctx.agent.get('/api/tables');
    expect(tables.body.tables.find((t) => t.id === 1).status).toBe('libre');

    const again = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'tarjeta' });
    expect(again.status).toBe(409);

    const edit = await addGuacamole(order.id, 1);
    expect(edit.status).toBe(409);
  });

  it('cobra con tarjeta sin cambio y registra el método', async () => {
    const order = await openTableOrder(3);
    await addGuacamole(order.id, 1);
    const response = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'tarjeta', cashReceivedCents: 999999 });
    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe('pagada');
    expect(response.body.order.paymentMethod).toBe('tarjeta');
    expect(response.body.order.cashReceivedCents).toBeNull();
    expect(response.body.order.changeCents).toBe(0);

    const tables = await ctx.agent.get('/api/tables');
    expect(tables.body.tables.find((t) => t.id === 3).status).toBe('libre');
  });

  it('anula un pedido y libera la mesa; solo permite anular pedidos abiertos', async () => {
    const order = await openTableOrder(4);
    const response = await ctx.agent.post(`/api/orders/${order.id}/cancel`).send({});
    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe('anulada');
    expect(response.body.order.cancelledAt).toBeTruthy();

    const tables = await ctx.agent.get('/api/tables');
    expect(tables.body.tables.find((t) => t.id === 4).status).toBe('libre');

    const again = await ctx.agent.post(`/api/orders/${order.id}/cancel`).send({});
    expect(again.status).toBe(409);
  });

  it('gestiona pedidos para llevar sin mesa', async () => {
    const order = await openTableOrder(5);
    await ctx.agent.post(`/api/orders/${order.id}/cancel`);

    const takeaway = await createOrder(ctx.agent, { type: 'llevar', customerName: 'Ana' });
    expect(takeaway.status).toBe(201);
    expect(takeaway.body.order.tableId).toBeNull();
    expect(takeaway.body.order.customerName).toBe('Ana');

    await ctx.agent
      .patch(`/api/orders/${takeaway.body.order.id}/draft`)
      .send({ items: [line('line-000001', 10, 2)] });
    const paid = await ctx.agent
      .post(`/api/orders/${takeaway.body.order.id}/pay`)
      .send({ paymentMethod: 'otro', cashReceivedCents: 0 });
    expect(paid.status).toBe(200);
    expect(paid.body.order.status).toBe('pagada');

    const openTakeaway = await ctx.agent.get('/api/orders?status=abierta&type=llevar');
    expect(openTakeaway.body.orders).toHaveLength(0);
  });

  it('mantiene el precio de la línea aunque cambie el catálogo', async () => {
    const order = await openTableOrder(1);
    await addGuacamole(order.id, 1);

    const priceUpdate = await ctx.agent
      .patch('/api/admin/products/1')
      .send({ priceCents: 12000 });
    expect(priceUpdate.status).toBe(200);

    const updated = await ctx.agent
      .patch(`/api/orders/${order.id}/draft`)
      .send({ items: [line('line-000001', 1, 2)] });
    expect(updated.status).toBe(200);
    expect(updated.body.order.items[0].unitPriceCents).toBe(8900);
    expect(updated.body.order.subtotalCents).toBe(17800);
  });

  it('rechaza productos desactivados en líneas nuevas', async () => {
    await ctx.agent.patch('/api/admin/products/2').send({ active: false });
    const order = await openTableOrder(1);
    const response = await ctx.agent
      .patch(`/api/orders/${order.id}/draft`)
      .send({ items: [line('line-000001', 2, 1)] });
    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/no está disponible/i);
  });

  it('conserva una línea existente si el producto se desactiva después', async () => {
    const order = await openTableOrder(1);
    await addGuacamole(order.id, 1);
    await ctx.agent.patch('/api/admin/products/1').send({ active: false });

    const response = await ctx.agent
      .patch(`/api/orders/${order.id}/draft`)
      .send({ items: [line('line-000001', 1, 2)] });
    expect(response.status).toBe(200);
    expect(response.body.order.items[0].quantity).toBe(2);
    expect(response.body.order.subtotalCents).toBe(17800);
  });

  it('lista pedidos con filtros y paginación', async () => {
    const order = await openTableOrder(1);
    await addGuacamole(order.id, 1);
    await ctx.agent.post(`/api/orders/${order.id}/pay`).send({ paymentMethod: 'tarjeta' });

    const list = await ctx.agent.get('/api/orders?status=pagada&limit=10&offset=0');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.orders[0].itemCount).toBe(1);

    const empty = await ctx.agent.get('/api/orders?status=pagada&date=2020-01-01');
    expect(empty.body.total).toBe(0);
  });
});
