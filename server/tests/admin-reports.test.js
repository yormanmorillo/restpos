import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeContext, line } from './helpers.js';
import { businessDateFor } from '../src/business-date.js';

let ctx;

beforeEach(() => {
  ctx = makeContext();
});

afterEach(() => {
  ctx.db.close();
});

async function createPaidOrder({ tableId, productId = 1, quantity = 2, tipType = 'percent', tipValue = 1000, paymentMethod = 'efectivo' }) {
  const created = await request(ctx.app)
    .post('/api/orders')
    .send({ type: 'mesa', tableId });
  expect(created.status).toBe(201);
  const id = created.body.order.id;
  const draft = await request(ctx.app)
    .patch(`/api/orders/${id}/draft`)
    .send({
      items: [line('line-000001', productId, quantity)],
      tipType,
      tipValue,
    });
  expect(draft.status).toBe(200);
  const total = draft.body.order.totalCents;
  const pay = await request(ctx.app)
    .post(`/api/orders/${id}/pay`)
    .send({ paymentMethod, cashReceivedCents: paymentMethod === 'efectivo' ? total : undefined });
  expect(pay.status).toBe(200);
  return pay.body.order;
}

describe('administración de catálogo', () => {
  it('crea, edita y desactiva categorías', async () => {
    let response = await request(ctx.app)
      .post('/api/admin/categories')
      .send({ name: 'Especiales', description: 'Temporada', sortOrder: 50 });
    expect(response.status).toBe(201);
    const category = response.body.category;
    expect(category.active).toBe(true);

    const duplicate = await request(ctx.app)
      .post('/api/admin/categories')
      .send({ name: 'especiales' });
    expect(duplicate.status).toBe(409);

    response = await request(ctx.app)
      .patch(`/api/admin/categories/${category.id}`)
      .send({ active: false, name: 'Especiales de temporada' });
    expect(response.status).toBe(200);
    expect(response.body.category.active).toBe(false);

    const catalog = await request(ctx.app).get('/api/catalog');
    expect(catalog.body.categories.some((c) => c.id === category.id)).toBe(false);
  });

  it('crea, edita y desactiva productos con validación de precio', async () => {
    let response = await request(ctx.app)
      .post('/api/admin/products')
      .send({
        categoryId: 1,
        name: 'Croquetas',
        description: 'De queso',
        priceCents: 7500,
      });
    expect(response.status).toBe(201);
    const product = response.body.product;
    expect(product.priceCents).toBe(7500);

    const invalidPrice = await request(ctx.app)
      .post('/api/admin/products')
      .send({ categoryId: 1, name: 'Inválido', priceCents: -100 });
    expect(invalidPrice.status).toBe(422);

    const missingCategory = await request(ctx.app)
      .post('/api/admin/products')
      .send({ categoryId: 999, name: 'Fantasma', priceCents: 1000 });
    expect(missingCategory.status).toBe(404);

    response = await request(ctx.app)
      .patch(`/api/admin/products/${product.id}`)
      .send({ priceCents: 8200, active: false });
    expect(response.status).toBe(200);
    expect(response.body.product.priceCents).toBe(8200);
    expect(response.body.product.active).toBe(false);

    const catalog = await request(ctx.app).get('/api/catalog');
    const entrance = catalog.body.categories.find((c) => c.id === 1);
    const listed = entrance.products.find((p) => p.id === product.id);
    expect(listed.active).toBe(false);

    const order = await request(ctx.app).post('/api/orders').send({ type: 'mesa', tableId: 1 });
    const rejected = await request(ctx.app)
      .patch(`/api/orders/${order.body.order.id}/draft`)
      .send({ items: [line('line-000001', product.id, 1)] });
    expect(rejected.status).toBe(422);
  });

  it('valida duplicados y actualizaciones vacías', async () => {
    const duplicate = await request(ctx.app)
      .post('/api/admin/products')
      .send({ categoryId: 1, name: 'Guacamole con totopos', priceCents: 1000 });
    expect(duplicate.status).toBe(409);

    const empty = await request(ctx.app).patch('/api/admin/products/1').send({});
    expect(empty.status).toBe(422);

    const notFound = await request(ctx.app).patch('/api/admin/products/999').send({ active: false });
    expect(notFound.status).toBe(404);
  });

  it('agrupa el catálogo activo por categorías y marca disponibilidad', async () => {
    await request(ctx.app).patch('/api/admin/products/2').send({ active: false });
    const response = await request(ctx.app).get('/api/catalog');
    expect(response.status).toBe(200);
    expect(response.body.categories.map((c) => c.name)).toEqual([
      'Entradas',
      'Platos fuertes',
      'Bebidas',
      'Postres',
    ]);
    expect(response.body.taxRateBps).toBe(1600);
    const products = response.body.categories.flatMap((c) => c.products);
    expect(products.find((p) => p.id === 2).active).toBe(false);
    expect(products.find((p) => p.id === 1).active).toBe(true);
  });
});

describe('reporte diario', () => {
  it('calcula ventas, propinas, métodos de pago y productos más vendidos', async () => {
    const first = await createPaidOrder({
      tableId: 1,
      productId: 1,
      quantity: 2,
      paymentMethod: 'efectivo',
    });
    const second = await createPaidOrder({
      tableId: 2,
      productId: 1,
      quantity: 1,
      paymentMethod: 'tarjeta',
    });

    const today = businessDateFor(new Date(), ctx.config.timezone);
    const response = await request(ctx.app).get(`/api/reports/daily?date=${today}`);
    expect(response.status).toBe(200);
    const report = response.body;
    expect(report.orderCount).toBe(2);
    expect(report.salesCents).toBe(first.totalCents - first.tipCents + second.totalCents - second.tipCents);
    expect(report.totalCollectedCents).toBe(first.totalCents + second.totalCents);
    expect(report.tipCents).toBe(first.tipCents + second.tipCents);
    expect(report.payments.efectivo.totalCents).toBe(first.totalCents);
    expect(report.payments.tarjeta.totalCents).toBe(second.totalCents);
    expect(report.payments.otro.totalCents).toBe(0);
    expect(report.topProducts[0]).toMatchObject({
      productName: 'Guacamole con totopos',
      quantity: 3,
    });
  });

  it('filtra el reporte por fecha y devuelve ceros en días sin ventas', async () => {
    await createPaidOrder({ tableId: 1, productId: 2, quantity: 1 });
    const response = await request(ctx.app).get('/api/reports/daily?date=2020-02-20');
    expect(response.status).toBe(200);
    expect(response.body.orderCount).toBe(0);
    expect(response.body.totalCollectedCents).toBe(0);
    expect(response.body.topProducts).toEqual([]);
  });

  it('valida fechas de reporte imposibles', async () => {
    const response = await request(ctx.app).get('/api/reports/daily?date=2026-02-31');
    expect(response.status).toBe(422);
  });
});
