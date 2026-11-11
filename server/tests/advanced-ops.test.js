import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { rmSync } from 'node:fs';
import { makeContext, line } from './helpers.js';
import { hashPin } from '../src/auth.js';

let ctx;
let ownerAgent;

beforeEach(async () => {
  ctx = await makeContext();
  const now = new Date().toISOString();
  const result = ctx.db
    .prepare("INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at) VALUES ('Owner Test', 'owner', ?, 1, ?, ?)")
    .run(hashPin('9876'), now, now);
  ownerAgent = request.agent(ctx.app);
  const login = await ownerAgent.post('/api/auth/login').send({ staffId: Number(result.lastInsertRowid), pin: '9876' });
  expect(login.status).toBe(200);
});

afterEach(() => {
  ctx.db.close();
  rmSync(ctx.config.uploadsPath, { recursive: true, force: true });
});

async function paidDineIn(productId = 1, quantity = 1) {
  const orderResponse = await ctx.agent.post('/api/orders').send({ type: 'mesa', tableId: 1 });
  const order = orderResponse.body.order;
  await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({ items: [line('line-advanced-01', productId, quantity)] });
  const paid = await ctx.agent.post(`/api/orders/${order.id}/pay`).send({ paymentMethod: 'tarjeta' });
  expect(paid.status).toBe(200);
  return paid.body.order;
}

describe('propietario y factura pública', () => {
  it('permite al propietario administrar integraciones y bloquea al gerente', async () => {
    const created = await ownerAgent.post('/api/integrations').send({
      name: 'Facturación CR',
      category: 'accounting',
      baseUrl: 'https://api.facturacion.example/v1',
      authType: 'bearer',
      apiKey: 'secret-token',
      active: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.integration.apiKeyMasked).toMatch(/••••/);
    expect(created.body.integration.hasApiKey).toBe(true);

    const list = await ownerAgent.get('/api/integrations');
    expect(list.body.integrations).toHaveLength(1);
    const denied = await ctx.agent.get('/api/integrations');
    expect(denied.status).toBe(403);

    const disabled = await ownerAgent.patch(`/api/integrations/${created.body.integration.id}`).send({ active: false });
    expect(disabled.body.integration.active).toBe(false);
  });

  it('crea un enlace público de factura y lo comparte sin exponer datos privados', async () => {
    const order = await paidDineIn(1, 1);
    expect(order.publicReceiptUrl).toMatch(/^\/r\//);

    const share = await ctx.agent.get(`/api/orders/${order.id}/share`);
    expect(share.status).toBe(200);
    expect(share.body.url).toBe(order.publicReceiptUrl);
    expect(share.body.message).toContain(order.orderNumber);

    const publicResponse = await request(ctx.app).get(`/api/public/receipts/${order.publicReceiptToken}`);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.body.receipt.orderNumber).toBe(order.orderNumber);
    expect(publicResponse.body.receipt.customerPhone).toBeUndefined();
    expect(publicResponse.body.receipt.deliveryAddress).toBeUndefined();
    expect(publicResponse.body.receipt.items).toHaveLength(1);
    expect(publicResponse.body.receipt.payments[0].methodName).toBe('Tarjeta débito/crédito');
  });

  it('solo el propietario puede crear otro propietario', async () => {
    const denied = await ctx.agent.post('/api/staff').send({ name: 'Owner 2', role: 'owner', pin: '468135' });
    expect(denied.status).toBe(403);
    const allowed = await ownerAgent.post('/api/staff').send({ name: 'Owner 2', role: 'owner', pin: '468135' });
    expect(allowed.status).toBe(201);
    expect(allowed.body.staff.role).toBe('owner');
  });
});

describe('inventario y recetas', () => {
  it('recibe mercancía, descuenta ingredientes al vender y permite ajustar', async () => {
    const itemResponse = await ctx.agent.post('/api/inventory/items').send({
      name: 'Pasta seca', sku: 'PAS-001', unit: 'g', minQuantity: 100,
    });
    expect(itemResponse.status).toBe(201);
    const item = itemResponse.body.item;

    const received = await ctx.agent.post(`/api/inventory/items/${item.id}/receipts`).send({
      quantity: 1000, costCents: 2500, reference: 'Factura 12', notes: 'Compra semanal',
    });
    expect(received.status).toBe(201);
    expect(received.body.item.currentQuantity).toBe(1000);

    const recipe = await ctx.agent.put('/api/inventory/recipes/1').send({
      ingredients: [{ inventoryItemId: item.id, quantity: 100 }],
    });
    expect(recipe.status).toBe(200);
    expect(recipe.body.recipe.ingredients[0].quantity).toBe(100);

    await paidDineIn(1, 2);
    const after = await ctx.agent.get('/api/inventory/items');
    const pasta = after.body.items.find((entry) => entry.id === item.id);
    expect(pasta.currentQuantity).toBe(800);

    const movements = await ctx.agent.get(`/api/inventory/movements?itemId=${item.id}`);
    expect(movements.body.movements.some((movement) => movement.type === 'consumption' && movement.quantity === -200)).toBe(true);

    const adjusted = await ctx.agent.post(`/api/inventory/items/${item.id}/adjustments`).send({ countedQuantity: 750, notes: 'Conteo' });
    expect(adjusted.body.item.currentQuantity).toBe(750);
  });
});

describe('carga masiva de productos', () => {
  it('importa CSV, crea categorías y actualiza productos existentes', async () => {
    const csv = [
      'categoria,nombre,descripcion,precio,activo,orden',
      'Entradas,Guacamole con totopos,Actualizado,95.00,si,10',
      'Especiales,Croquetas de queso,Deliciosas,75.50,si,5',
    ].join('\n');
    const response = await ctx.agent
      .post('/api/admin/products/import')
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'productos.csv', contentType: 'text/csv' });
    expect(response.status).toBe(200);
    expect(response.body.result.created).toBe(1);
    expect(response.body.result.updated).toBe(1);

    const products = await ctx.agent.get('/api/admin/products');
    const guac = products.body.products.find((product) => product.name === 'Guacamole con totopos');
    expect(guac.priceCents).toBe(9500);
    const croquetas = products.body.products.find((product) => product.name === 'Croquetas de queso');
    expect(croquetas.categoryName).toBe('Especiales');
  });
});
