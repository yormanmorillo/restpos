import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { makeContext, line } from './helpers.js';

let ctx;

beforeEach(async () => {
  ctx = await makeContext();
});

afterEach(() => {
  ctx.db.close();
});

async function createTableOrder(tableId = 1) {
  const response = await ctx.agent.post('/api/orders').send({ type: 'mesa', tableId });
  expect(response.status).toBe(201);
  return response.body.order;
}

async function addLine(orderId, body) {
  return ctx.agent.patch(`/api/orders/${orderId}/draft`).send({ items: [body] });
}

describe('autenticación y permisos', () => {
  it('protege los endpoints y permite iniciar sesión con PIN', async () => {
    const anonymous = request(ctx.app);
    expect((await anonymous.get('/api/orders')).status).toBe(401);
    expect((await anonymous.get('/api/admin/products')).status).toBe(401);

    const options = await anonymous.get('/api/auth/options');
    expect(options.status).toBe(200);
    expect(options.body.staff).toHaveLength(1);
    expect(options.body.staff[0].role).toBeUndefined();

    const wrong = await anonymous
      .post('/api/auth/login')
      .send({ staffId: ctx.staffId, pin: '9999' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const login = await anonymous
      .post('/api/auth/login')
      .send({ staffId: ctx.staffId, pin: '1234' });
    expect(login.status).toBe(200);
    expect(login.body.staff.role).toBe('admin');
  });

  it('aplica permisos por rol', async () => {
    const created = await ctx.agent.post('/api/staff').send({
      name: 'Chef QA',
      role: 'kitchen',
      pin: '246813',
    });
    expect(created.status).toBe(201);
    const chefId = created.body.staff.id;
    const chefAgent = request.agent(ctx.app);
    const login = await chefAgent.post('/api/auth/login').send({ staffId: chefId, pin: '246813' });
    expect(login.status).toBe(200);

    expect((await chefAgent.get('/api/kitchen/orders')).status).toBe(200);
    expect((await chefAgent.get('/api/orders')).status).toBe(403);
    expect((await chefAgent.post('/api/admin/products').send({})).status).toBe(403);
  });

  it('crea el primer administrador solo una vez', async () => {
    const anonymous = request.agent(ctx.app);
    const status = await anonymous.get('/api/auth/status');
    expect(status.body.setupRequired).toBe(false);
    const setup = await anonymous.post('/api/auth/setup').send({ name: 'Otro', pin: '468135' });
    expect(setup.status).toBe(409);
  });
});

describe('modificadores y cocina', () => {
  it('calcula el precio con extras y obliga a elegir grupos requeridos', async () => {
    const catalog = await ctx.agent.get('/api/catalog');
    expect(catalog.status).toBe(200);
    const products = catalog.body.categories.flatMap((category) => category.products);
    const guacamole = products.find((product) => product.name === 'Guacamole con totopos');
    const burger = products.find((product) => product.name === 'Hamburguesa de res');
    expect(guacamole.modifierGroups.length).toBeGreaterThan(0);
    expect(burger.modifierGroups.some((group) => group.required)).toBe(true);

    const order = await createTableOrder(1);
    let response = await addLine(order.id, line('line-mod-0001', burger.id, 1));
    expect(response.status).toBe(422);
    expect(response.body.error.message).toMatch(/requiere/i);

    const termGroup = burger.modifierGroups.find((group) => group.required);
    const term = termGroup.options[0];
    response = await addLine(order.id, {
      ...line('line-mod-0001', burger.id, 1),
      modifiers: [term.id],
    });
    expect(response.status).toBe(200);
    expect(response.body.order.items[0].modifiers[0].modifierName).toBe(term.name);

    const extras = guacamole.modifierGroups[0];
    const extraQueso = extras.options.find((option) => option.name === 'Extra queso');
    response = await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({
      items: [
        { ...line('line-mod-0001', burger.id, 1), modifiers: [term.id] },
        { ...line('line-mod-0002', guacamole.id, 2), modifiers: [extraQueso.id] },
      ],
    });
    expect(response.status).toBe(200);
    const guacLine = response.body.order.items.find((item) => item.clientKey === 'line-mod-0002');
    expect(guacLine.unitPriceCents).toBe(10400);
    expect(guacLine.lineTotalCents).toBe(20800);
    expect(guacLine.modifiersTotalCents).toBe(1500);
  });

  it('envía a cocina y gestiona estados de platillos', async () => {
    const order = await createTableOrder(1);
    await addLine(order.id, line('line-kitchen-01', 1, 1));
    const sent = await ctx.agent.post(`/api/orders/${order.id}/send-kitchen`).send({});
    expect(sent.status).toBe(200);
    expect(sent.body.order.items[0].status).toBe('sent');

    const tickets = await ctx.agent.get('/api/kitchen/orders');
    expect(tickets.status).toBe(200);
    expect(tickets.body.tickets).toHaveLength(1);
    const itemId = tickets.body.tickets[0].items[0].id;

    let update = await ctx.agent.patch(`/api/kitchen/items/${itemId}`).send({ status: 'preparing' });
    expect(update.status).toBe(200);
    update = await ctx.agent.patch(`/api/kitchen/items/${itemId}`).send({ status: 'ready' });
    expect(update.status).toBe(200);
    update = await ctx.agent.patch(`/api/kitchen/items/${itemId}`).send({ status: 'served' });
    expect(update.status).toBe(200);

    const empty = await ctx.agent.get('/api/kitchen/orders');
    expect(empty.body.tickets).toHaveLength(0);
  });

  it('permite administrar grupos y asignarlos a productos', async () => {
    const created = await ctx.agent.post('/api/modifier-groups').send({
      name: 'Salsas',
      selectionType: 'multiple',
      required: false,
      minSelect: 0,
      maxSelect: 3,
      options: [
        { name: 'Salsa verde', priceDeltaCents: 0 },
        { name: 'Salsa roja', priceDeltaCents: 0 },
      ],
    });
    expect(created.status).toBe(201);
    const groupId = created.body.group.id;
    const assignment = await ctx.agent.put('/api/admin/products/1/modifier-groups').send({ groupIds: [groupId] });
    expect(assignment.status).toBe(200);
    expect(assignment.body.groups[0].name).toBe('Salsas');
  });
});

describe('pagos parciales y turnos', () => {
  it('permite pagos parciales, bloquea edición y cierra con el saldo', async () => {
    const order = await createTableOrder(1);
    await addLine(order.id, line('line-pay-0001', 1, 1));
    const total = 10324;

    let payment = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'tarjeta', amountCents: 4000 });
    expect(payment.status).toBe(200);
    expect(payment.body.order.status).toBe('abierta');
    expect(payment.body.order.amountPaidCents).toBe(4000);
    expect(payment.body.order.balanceCents).toBe(total - 4000);
    expect(payment.body.order.payments).toHaveLength(1);

    const edit = await addLine(order.id, line('line-pay-0001', 1, 2));
    expect(edit.status).toBe(409);

    payment = await ctx.agent
      .post(`/api/orders/${order.id}/pay`)
      .send({ paymentMethod: 'efectivo', cashReceivedCents: total - 4000 + 500 });
    expect(payment.status).toBe(200);
    expect(payment.body.order.status).toBe('pagada');
    expect(payment.body.order.payments).toHaveLength(2);
    expect(payment.body.order.changeCents).toBe(500);

    const shift = await ctx.agent.get('/api/shifts/current');
    expect(shift.body.totals.efectivo).toBe(total - 4000);
    expect(shift.body.totals.tarjeta).toBe(4000);
  });

  it('abre y cierra el turno con diferencia de caja', async () => {
    const order = await createTableOrder(2);
    await addLine(order.id, line('line-shift-001', 1, 1));
    await ctx.agent.post(`/api/orders/${order.id}/pay`).send({ paymentMethod: 'efectivo', cashReceivedCents: 11000 });

    const current = await ctx.agent.get('/api/shifts/current');
    expect(current.status).toBe(200);
    expect(current.body.shift).not.toBeNull();
    const expected = current.body.totals.expectedCents;
    const closed = await ctx.agent
      .post(`/api/shifts/${current.body.shift.id}/close`)
      .send({ countedCents: expected - 100, notes: 'Faltante de prueba' });
    expect(closed.status).toBe(200);
    expect(closed.body.shift.status).toBe('closed');
    expect(closed.body.shift.differenceCents).toBe(-100);

    const next = await createTableOrder(3);
    await addLine(next.id, line('line-shift-002', 1, 1));
    const denied = await ctx.agent
      .post(`/api/orders/${next.id}/pay`)
      .send({ paymentMethod: 'efectivo', cashReceivedCents: 11000 });
    expect(denied.status).toBe(409);
    expect(denied.body.error.details.code).toBe('SHIFT_CLOSED');
  });
});

describe('pedidos en línea y configuración', () => {
  it('habilita el menú público y crea un pedido de delivery', async () => {
    const anonymous = request(ctx.app);
    expect((await anonymous.get('/api/public/restaurant')).status).toBe(403);

    let settings = await ctx.agent.patch('/api/settings').send({
      settings: { online_ordering_enabled: 'true', delivery_fee_cents: '2500' },
    });
    expect(settings.status).toBe(200);

    const menu = await anonymous.get('/api/public/restaurant');
    expect(menu.status).toBe(200);
    expect(menu.body.categories.length).toBeGreaterThan(0);
    const product = menu.body.categories[0].products[0];
    const created = await anonymous.post('/api/public/orders').send({
      fulfillment: 'delivery',
      customerName: 'Cliente Público',
      customerPhone: '5512345678',
      deliveryAddress: 'Calle Roble 123, Centro, CDMX',
      notes: 'Tocar timbre',
      items: [{ productId: product.id, quantity: 1, notes: '', modifiers: [] }],
    });
    expect(created.status).toBe(201);
    expect(created.body.order.fulfillment).toBe('delivery');
    expect(created.body.order.totalCents).toBeGreaterThanOrEqual(2500);

    const open = await ctx.agent.get('/api/orders?status=abierta');
    expect(open.body.orders[0].source).toBe('online');
    expect(open.body.orders[0].delivery).toBe(true);
  });

  it('rechaza delivery cuando está desactivado', async () => {
    await ctx.agent.patch('/api/settings').send({
      settings: {
        online_ordering_enabled: 'true',
        online_delivery_enabled: 'false',
        online_pickup_enabled: 'true',
      },
    });
    const response = await request(ctx.app).post('/api/public/orders').send({
      fulfillment: 'delivery',
      customerName: 'Cliente',
      customerPhone: '5512345678',
      deliveryAddress: 'Calle Roble 123, Centro, CDMX',
      items: [{ productId: 1, quantity: 1, notes: '', modifiers: [] }],
    });
    expect(response.status).toBe(409);
  });

  it('expone el CSV del reporte diario', async () => {
    const response = await ctx.agent.get('/api/reports/daily.csv');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/csv/);
    expect(response.text).toContain('Reporte diario');
    expect(response.text).toContain('Producto');
  });
});
