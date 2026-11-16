import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { hashPin } from '../src/auth.js';
import { makeContext, line, createOrder } from './helpers.js';
import { dailyReportCsv } from '../src/reports.js';
import { openDatabase, migrate, seedDatabase, seedOperationalData } from '../src/db.js';
import { createApp } from '../src/app.js';

let ctx;

beforeEach(async () => {
  ctx = await makeContext();
});

afterEach(() => {
  ctx.db.close();
});

async function createStaff(role, pin = '246813', name = `Staff ${role}`) {
  const response = await ctx.agent.post('/api/staff').send({ name, role, pin });
  expect(response.status).toBe(201);
  const agent = request.agent(ctx.app);
  const login = await agent.post('/api/auth/login').send({ staffId: response.body.staff.id, pin });
  expect(login.status).toBe(200);
  return { id: response.body.staff.id, agent };
}

async function createOwner(pin = '468135') {
  const now = new Date().toISOString();
  const result = ctx.db
    .prepare("INSERT INTO staff (name, role, pin_hash, active, created_at, updated_at) VALUES ('Owner Test', 'owner', ?, 1, ?, ?)")
    .run(hashPin(pin), now, now);
  const agent = request.agent(ctx.app);
  const login = await agent.post('/api/auth/login').send({ staffId: Number(result.lastInsertRowid), pin });
  expect(login.status).toBe(200);
  return agent;
}

async function openOrderWithGuacamole(agent = ctx.agent, tableId = 1) {
  const response = await agent.post('/api/orders').send({ type: 'mesa', tableId });
  expect(response.status).toBe(201);
  const order = response.body.order;
  const draft = await agent.patch(`/api/orders/${order.id}/draft`).send({ items: [line('line-security-01', 1, 1)] });
  expect(draft.status).toBe(200);
  return draft.body.order;
}

describe('endurecimiento de autenticación', () => {
  it('no permite bloquear a un empleado desde otra cuenta y limita por empleado/IP', async () => {
    const attackIp = '203.0.113.10';
    const anon = request.agent(ctx.app);
    for (let index = 0; index < 5; index += 1) {
      await anon.post('/api/auth/login').set('X-Forwarded-For', attackIp).send({ staffId: ctx.staffId, pin: '9999' }).expect(401);
    }
    const blocked = await anon.post('/api/auth/login').set('X-Forwarded-For', attackIp).send({ staffId: ctx.staffId, pin: '1234' });
    expect(blocked.status).toBe(429);

    const otherIp = await request(ctx.app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.11')
      .send({ staffId: ctx.staffId, pin: '1234' });
    expect(otherIp.status).toBe(200);
  });

  it('rechaza PIN triviales o de menos de 6 dígitos', async () => {
    const short = await ctx.agent.post('/api/staff').send({ name: 'Corto', role: 'cashier', pin: '1234' });
    expect(short.status).toBe(422);
    const trivial = await ctx.agent.post('/api/staff').send({ name: 'Trivial', role: 'cashier', pin: '123456' });
    expect(trivial.status).toBe(422);
    const good = await ctx.agent.post('/api/staff').send({ name: 'Seguro', role: 'cashier', pin: '687951' });
    expect(good.status).toBe(201);
  });

  it('invalida las sesiones cuando se cambia el PIN', async () => {
    const staff = await createStaff('cashier', '246813', 'Caja Sesión');
    const current = await staff.agent.get('/api/auth/me');
    expect(current.status).toBe(200);
    const updated = await ctx.agent.patch(`/api/staff/${staff.id}`).send({ pin: '687951' });
    expect(updated.status).toBe(200);
    const after = await staff.agent.get('/api/auth/me');
    expect(after.status).toBe(401);
  });

  it('tolera cookies con codificación inválida', async () => {
    const response = await request(ctx.app)
      .get('/api/auth/status')
      .set('Cookie', 'restpos_session=%E0%A4%A');
    expect(response.status).toBe(200);
    expect(response.body.authenticated).toBe(false);
  });

  it('no expone la IP de impresoras en /features para cocina', async () => {
    ctx.db.prepare("UPDATE settings SET value = '192.168.1.50' WHERE key = 'kitchen_printer_host'").run();
    const kitchen = await createStaff('kitchen', '246813', 'Cocina Segura');
    const response = await kitchen.agent.get('/api/features');
    expect(response.status).toBe(200);
    expect(response.body.features.kitchen_printer_host).toBeUndefined();
    expect(response.body.features.printer_enabled).toBeDefined();
  });
});

describe('reglas de pedidos', () => {
  it('no convierte un pedido de mesa en delivery y recalcula el fee del delivery', async () => {
    const mesa = await createOrder(ctx.agent, { type: 'mesa', tableId: 1 });
    const rejected = await ctx.agent.patch(`/api/orders/${mesa.body.order.id}/draft`).send({ delivery: true });
    expect(rejected.status).toBe(422);

    await ctx.agent.patch('/api/settings').send({ settings: { delivery_fee_cents: '5000' } });
    const takeaway = await ctx.agent.post('/api/orders').send({ type: 'llevar' });
    const updated = await ctx.agent.patch(`/api/orders/${takeaway.body.order.id}/draft`).send({
      items: [line('line-security-02', 1, 1)],
      delivery: true,
      customerPhone: '5512345678',
      deliveryAddress: 'Calle 1',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.order.deliveryFeeCents).toBe(5000);
    expect(updated.body.order.delivery).toBe(true);
  });

  it('conserva el id de línea al actualizar y envía solo el adicional a cocina', async () => {
    const order = await openOrderWithGuacamole();
    const sent = await ctx.agent.post(`/api/orders/${order.id}/send-kitchen`).send({});
    expect(sent.status).toBe(200);
    const item = sent.body.order.items[0];
    expect(item.status).toBe('sent');
    expect(item.sentQuantity).toBe(1);

    const prepared = await ctx.agent.patch(`/api/kitchen/items/${item.id}`).send({ status: 'preparing' });
    expect(prepared.status).toBe(200);
    const updated = await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({
      items: [line(item.clientKey, 1, 3)],
    });
    expect(updated.status).toBe(200);
    expect(updated.body.order.items[0].id).toBe(item.id);
    expect(updated.body.order.items[0].status).toBe('preparing');
    expect(updated.body.order.items[0].sentQuantity).toBe(1);

    const ticket = await ctx.agent.get('/api/kitchen/orders');
    expect(ticket.body.tickets[0].items[0].id).toBe(item.id);
    expect(ticket.body.tickets[0].items[0].sentQuantity).toBe(1);

    const addition = await ctx.agent.post(`/api/orders/${order.id}/send-kitchen`).send({});
    expect(addition.status).toBe(200);
    expect(addition.body.order.items[0].sentQuantity).toBe(3);
  });

  it('limita descuentos por rol, exige motivo, audita y permite cortesía al 100%', async () => {
    const server = await createStaff('server', '246813', 'Mesero Descuento');
    const order = await openOrderWithGuacamole();
    const rejected = await server.agent.patch(`/api/orders/${order.id}/draft`).send({
      items: [line('line-security-01', 1, 1)],
      discountType: 'percent',
      discountValue: 9900,
      discountReason: 'Prueba',
    });
    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('DISCOUNT_LIMIT');

    const missingReason = await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({
      items: [line('line-security-01', 1, 1)], discountType: 'percent', discountValue: 1000,
    });
    expect(missingReason.status).toBe(422);

    const allowed = await ctx.agent.patch(`/api/orders/${order.id}/draft`).send({
      items: [line('line-security-01', 1, 1)],
      discountType: 'percent',
      discountValue: 10000,
      discountReason: 'Cortesía autorizada',
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.order.totalCents).toBe(0);
    expect(allowed.body.order.discountReason).toBe('Cortesía autorizada');

    const courtesy = await ctx.agent.post(`/api/orders/${order.id}/courtesy`).send({ reason: 'Cortesía autorizada' });
    expect(courtesy.status).toBe(200);
    expect(courtesy.body.order.status).toBe('pagada');
    expect(courtesy.body.order.totalCents).toBe(0);
    const audit = ctx.db.prepare("SELECT details FROM audit_logs WHERE action = 'order.courtesy' ORDER BY id DESC LIMIT 1").get();
    expect(audit.details).toContain('Cortesía autorizada');
  });
});

describe('entradas no confiables', () => {
  it('rechaza importaciones con precios fuera de rango sin responder 500', async () => {
    const csv = 'categoria,nombre,precio\nEntradas,Producto caro,20000\n';
    const response = await ctx.agent
      .post('/api/admin/products/import')
      .attach('file', Buffer.from(csv, 'utf8'), { filename: 'productos.csv', contentType: 'text/csv' });
    expect(response.status).toBe(200);
    expect(response.body.result.errors[0].line).toBe(2);
    expect(response.body.result.errors[0].message).toMatch(/precio/i);
    expect(response.body.result.created).toBe(0);
  });

  it('exige token para configurar el primer administrador en producción', async () => {
    const db = openDatabase(':memory:');
    migrate(db);
    seedDatabase(db, { now: '2026-01-01T12:00:00.000Z' });
    seedOperationalData(db);
    const app = createApp({
      db,
      config: {
        nodeEnv: 'production', port: 0, databasePath: ':memory:', uploadsPath: ctx.config.uploadsPath,
        timezone: 'America/Mexico_City', currency: 'MXN', taxRateBps: 1600,
        sessionTtlHours: 12, cookieSecure: false, setupToken: 'setup-secreto', trustProxyHops: 0,
      },
    });
    try {
      const denied = await request(app).post('/api/auth/setup').send({ name: 'Admin', pin: '468135' });
      expect(denied.status).toBe(403);
      const allowed = await request(app)
        .post('/api/auth/setup')
        .set('X-Setup-Token', 'setup-secreto')
        .send({ name: 'Admin', pin: '468135' });
      expect(allowed.status).toBe(201);
      expect(allowed.body.staff.role).toBe('owner');
    } finally {
      db.close();
    }
  });

  it('rechaza archivos que dicen ser imagen pero no lo son', async () => {
    const response = await ctx.agent
      .post('/api/admin/products/1/image')
      .attach('image', Buffer.from('no soy una imagen'), { filename: 'falsa.png', contentType: 'image/png' });
    expect(response.status).toBe(422);
  });

  it('bloquea hosts de impresora link-local y permite solo redes privadas', async () => {
    const owner = await createOwner();
    const blocked = await owner.patch('/api/settings').send({ settings: { kitchen_printer_host: '169.254.169.254' } });
    expect(blocked.status).toBe(422);
    const local = await owner.patch('/api/settings').send({ settings: { kitchen_printer_host: 'localhost' } });
    expect(local.status).toBe(422);
    const allowed = await owner.patch('/api/settings').send({ settings: { printer_allowed_hosts: '192.168.1.50', kitchen_printer_host: '192.168.1.50' } });
    expect(allowed.status).toBe(200);
    const manager = await createStaff('manager', '246813', 'Gerente Impresora');
    const denied = await manager.agent.patch('/api/settings').send({ settings: { printer_allowed_hosts: '192.168.1.51', receipt_printer_host: '192.168.1.51' } });
    expect(denied.status).toBe(200);
    expect(ctx.db.prepare("SELECT value FROM settings WHERE key = 'receipt_printer_host'").get().value).toBe('');
  });

  it('neutraliza fórmulas en el CSV del reporte', () => {
    const csv = dailyReportCsv({
      date: '2026-01-01', timezone: 'America/Mexico_City', currency: 'MXN', orderCount: 0,
      salesCents: 0, totalCollectedCents: 0, tipCents: 0, subtotalCents: 0, discountCents: 0,
      taxCents: 0, deliveryFeesCents: 0, payments: {}, paymentMethods: [], categories: [], staff: [], hours: [],
      topProducts: [{ productName: '=HYPERLINK("http://evil")', quantity: 1, revenueCents: 100 }],
    });
    expect(csv).toContain("'=HYPERLINK");
  });
});
