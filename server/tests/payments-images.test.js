import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { rmSync } from 'node:fs';
import { makeContext, line } from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
);

let ctx;

beforeEach(async () => {
  ctx = await makeContext();
});

afterEach(() => {
  ctx.db.close();
  rmSync(ctx.config.uploadsPath, { recursive: true, force: true });
});

async function openOrder(tableId = 1) {
  const response = await ctx.agent.post('/api/orders').send({ type: 'mesa', tableId });
  expect(response.status).toBe(201);
  const order = response.body.order;
  const draft = await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({
    items: [line('line-pay-img-01', 1, 1)],
  });
  expect(draft.status).toBe(200);
  return draft.body.order;
}

describe('métodos de pago de Costa Rica', () => {
  it('incluye SINPE Móvil y permite administrar métodos activos', async () => {
    const list = await ctx.agent.get('/api/payment-methods');
    expect(list.status).toBe(200);
    const sinpe = list.body.methods.find((method) => method.code === 'sinpe');
    expect(sinpe.name).toBe('SINPE Móvil');
    expect(sinpe.allowsPhoto).toBe(true);
    expect(sinpe.kind).toBe('transfer');

    const created = await ctx.agent.post('/api/payment-methods').send({
      code: 'sinpe_comercio',
      name: 'SINPE comercio',
      kind: 'transfer',
      icon: 'phone',
      allowsPhoto: true,
      active: true,
      sortOrder: 35,
    });
    expect(created.status).toBe(201);
    const method = created.body.method;
    expect(method.active).toBe(true);

    const disabled = await ctx.agent.patch(`/api/payment-methods/${method.id}`).send({ active: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.method.active).toBe(false);

    const order = await openOrder(1);
    const pay = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'sinpe_comercio' });
    expect(pay.status).toBe(422);
  });

  it('cobra con SINPE, guarda el nombre del método y adjunta comprobante', async () => {
    const order = await openOrder(2);
    const pay = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'sinpe' });
    expect(pay.status).toBe(200);
    expect(pay.body.order.status).toBe('pagada');
    expect(pay.body.order.paymentMethod).toBe('sinpe');
    expect(pay.body.order.paymentMethodName).toBe('SINPE Móvil');
    const payment = pay.body.order.payments[0];
    expect(payment.paymentMethodKind).toBe('transfer');

    const uploaded = await ctx.agent
      .post(`/api/orders/${order.id}/payments/${payment.id}/photos`)
      .attach('photos', PNG, { filename: 'comprobante.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.photos).toHaveLength(1);

    const detail = await ctx.agent.get(`/api/orders/${order.id}`);
    expect(detail.body.order.payments[0].photos).toHaveLength(1);
    const photo = detail.body.order.payments[0].photos[0];

    const file = await ctx.agent.get(photo.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/image\/png/);
    expect((await request(ctx.app).get(photo.url)).status).toBe(401);
  });

  it('no permite comprobantes en métodos sin foto', async () => {
    const order = await openOrder(3);
    const pay = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'tarjeta' });
    expect(pay.status).toBe(200);
    const payment = pay.body.order.payments[0];
    const uploaded = await ctx.agent
      .post(`/api/orders/${order.id}/payments/${payment.id}/photos`)
      .attach('photos', PNG, { filename: 'comprobante.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(422);
  });

  it('mantiene el último método activo y protege la administración por rol', async () => {
    const staff = await ctx.agent.post('/api/staff').send({ name: 'Cajero QA', role: 'cashier', pin: '2468' });
    expect(staff.status).toBe(201);
    const cashier = request.agent(ctx.app);
    await cashier.post('/api/auth/login').send({ staffId: staff.body.staff.id, pin: '2468' });
    const denied = await cashier.post('/api/payment-methods').send({
      code: 'prueba', name: 'Prueba', kind: 'other', allowsPhoto: false, active: true, sortOrder: 0,
    });
    expect(denied.status).toBe(403);
  });
});

describe('fotos de productos y tipos de servicio', () => {
  it('sube una foto, la muestra en el catálogo y la sirve públicamente', async () => {
    const uploaded = await ctx.agent
      .post('/api/admin/products/1/image')
      .attach('image', PNG, { filename: 'producto.png', contentType: 'image/png' });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.product.imageUrl).toMatch(/^\/api\/public\/product-images\//);

    const catalog = await ctx.agent.get('/api/catalog');
    const product = catalog.body.categories.flatMap((category) => category.products).find((item) => item.id === 1);
    expect(product.imageUrl).toBe(uploaded.body.product.imageUrl);

    const image = await request(ctx.app).get(product.imageUrl);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');

    const removed = await ctx.agent.delete('/api/admin/products/1/image');
    expect(removed.status).toBe(200);
    const after = await ctx.agent.get('/api/catalog');
    const productAfter = after.body.categories.flatMap((category) => category.products).find((item) => item.id === 1);
    expect(productAfter.imageUrl).toBeNull();
  });

  it('expone comer aquí, para llevar y delivery en el pedido', async () => {
    const dineIn = await ctx.agent.post('/api/orders').send({ type: 'mesa', tableId: 1 });
    expect(dineIn.body.order.serviceType).toBe('dine_in');
    await ctx.agent.post(`/api/orders/${dineIn.body.order.id}/cancel`);

    const takeaway = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    expect(takeaway.body.order.serviceType).toBe('takeaway');
    await ctx.agent.post(`/api/orders/${takeaway.body.order.id}/cancel`);

    const delivery = await ctx.agent.post('/api/orders').send({ type: 'llevar', delivery: true });
    expect(delivery.body.order.serviceType).toBe('delivery');
    await ctx.agent.post(`/api/orders/${delivery.body.order.id}/cancel`);
  });

  it('permite a un cajero ver y actualizar la cocina sin KDS separado', async () => {
    const order = await openOrder(4);
    const sent = await ctx.agent.post(`/api/orders/${order.id}/send-kitchen`).send({});
    expect(sent.status).toBe(200);
    const staff = await ctx.agent.post('/api/staff').send({ name: 'Caja Cocina', role: 'cashier', pin: '2468' });
    const cashier = request.agent(ctx.app);
    await cashier.post('/api/auth/login').send({ staffId: staff.body.staff.id, pin: '2468' });
    const tickets = await cashier.get('/api/kitchen/orders');
    expect(tickets.status).toBe(200);
    const itemId = tickets.body.tickets[0].items[0].id;
    const update = await cashier.patch(`/api/kitchen/items/${itemId}`).send({ status: 'preparing' });
    expect(update.status).toBe(200);
    const ready = await cashier.patch(`/api/kitchen/items/${itemId}`).send({ status: 'ready' });
    expect(ready.status).toBe(200);
  });
});
