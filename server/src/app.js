import express from 'express';
import { AppError } from './errors.js';
import {
  registerAuthRoutes,
  authenticate,
  requireRoles,
  createStaff,
  updateStaff,
  listStaff,
} from './auth.js';
import { getSettings, updateSettings } from './settings.js';
import { registerPublicRoutes } from './public.js';
import { getCatalog } from './catalog.js';
import { listTables, createOrder, getOrder, updateOrderDraft, payOrder, cancelOrder, listOrders, sendOrderToKitchen } from './orders.js';
import { getDailyReport, dailyReportCsv } from './reports.js';
import { getBooleanSetting } from './settings.js';
import { printOrder } from './printer.js';
import { getKitchenTickets, updateKitchenItem, updateKitchenTicket } from './kitchen.js';
import { getShiftSummary, getOpenShift, openShift, closeShift } from './shifts.js';
import { listModifierGroups, createModifierGroup, updateModifierGroup, setProductModifierGroups } from './modifiers.js';
import {
  listAdminCategories,
  createCategory,
  updateCategory,
  listAdminProducts,
  createProduct,
  updateProduct,
} from './admin.js';
import {
  parseOrThrow,
  assertValidDate,
  idParamsSchema,
  createOrderSchema,
  draftSchema,
  payOrderSchema,
  orderListQuerySchema,
  dateQuerySchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  productCreateSchema,
  productUpdateSchema,
  staffCreateSchema,
  staffUpdateSchema,
  settingsUpdateSchema,
  areaCreateSchema,
  areaUpdateSchema,
  tableCreateSchema,
  tableUpdateSchema,
  shiftOpenSchema,
  shiftCloseSchema,
  kitchenItemUpdateSchema,
  kitchenTicketUpdateSchema,
  modifierGroupCreateSchema,
  modifierGroupUpdateSchema,
  productModifierGroupsSchema,
} from './validation.js';
import { listAreas, createArea, updateArea, listAdminTables, createTable, updateTable } from './areas.js';

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '256kb', strict: true }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const api = express.Router();

  api.get('/health', (req, res) => {
    db.prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      service: 'casa-roble-pos-api',
      timezone: config.timezone,
      currency: config.currency,
      taxRateBps: config.taxRateBps,
      timestamp: new Date().toISOString(),
    });
  });

  registerAuthRoutes(api, db, config);
  registerPublicRoutes(api, db, config);

  // A partir de aquí todas las rutas requieren una sesión de empleado.
  api.use(authenticate(db));

  api.get('/auth/me', (req, res) => {
    res.json({ staff: req.staff });
  });

  api.get('/features', (req, res) => {
    res.json({ features: getSettings(db) });
  });

  api.get('/catalog', (req, res) => {
    res.json(getCatalog(db, config));
  });

  api.get('/tables', (req, res) => {
    res.json({ tables: listTables(db) });
  });

  api.get('/admin/tables', requireRoles('admin', 'manager'), (req, res) => {
    res.json({ tables: listAdminTables(db) });
  });

  api.post('/admin/tables', requireRoles('admin', 'manager'), (req, res) => {
    const input = parseOrThrow(tableCreateSchema, req.body);
    res.status(201).json({ table: createTable(db, input) });
  });

  api.patch('/admin/tables/:id', requireRoles('admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(tableUpdateSchema, req.body);
    res.json({ table: updateTable(db, id, input) });
  });

  api.get('/staff', requireRoles('admin', 'manager'), (req, res) => {
    res.json({ staff: listStaff(db) });
  });

  api.post('/staff', requireRoles('admin'), (req, res) => {
    const input = parseOrThrow(staffCreateSchema, req.body);
    res.status(201).json({ staff: createStaff(db, input, req.staff.id) });
  });

  api.patch('/staff/:id', requireRoles('admin'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(staffUpdateSchema, req.body);
    res.json({ staff: updateStaff(db, id, input, req.staff.id) });
  });

  api.get('/settings', requireRoles('admin', 'manager'), (req, res) => {
    res.json({ settings: getSettings(db) });
  });

  api.patch('/settings', requireRoles('admin', 'manager'), (req, res) => {
    const input = parseOrThrow(settingsUpdateSchema, req.body);
    res.json({ settings: updateSettings(db, input.settings) });
  });

  api.get('/areas', (req, res) => {
    res.json({ areas: listAreas(db) });
  });

  api.post('/areas', requireRoles('admin', 'manager'), (req, res) => {
    const input = parseOrThrow(areaCreateSchema, req.body);
    res.status(201).json({ area: createArea(db, input) });
  });

  api.patch('/areas/:id', requireRoles('admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(areaUpdateSchema, req.body);
    res.json({ area: updateArea(db, id, input) });
  });

  api.get('/orders', requireRoles('admin', 'manager', 'cashier', 'server'), (req, res) => {
    const query = parseOrThrow(orderListQuerySchema, req.query);
    assertValidDate(query.date);
    res.json(listOrders(db, query));
  });

  api.get('/orders/:id', requireRoles('admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    res.json({ order: getOrder(db, id) });
  });

  api.post('/orders', requireRoles('admin', 'manager', 'cashier', 'server'), (req, res) => {
    const input = parseOrThrow(createOrderSchema, req.body);
    const order = createOrder(db, config, input, { staffId: req.staff.id });
    res.status(201).json({ order });
  });

  api.patch('/orders/:id/draft', requireRoles('admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(draftSchema, req.body);
    res.json({ order: updateOrderDraft(db, config, id, input, { staffId: req.staff.id }) });
  });

  api.post('/orders/:id/pay', requireRoles('admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(payOrderSchema, req.body);
    res.json({ order: payOrder(db, config, id, input, { staffId: req.staff.id }) });
  });

  api.post('/orders/:id/cancel', requireRoles('admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    res.json({ order: cancelOrder(db, id, { staffId: req.staff.id }) });
  });

  api.post('/orders/:id/send-kitchen', requireRoles('admin', 'manager', 'cashier', 'server'), async (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const order = sendOrderToKitchen(db, id, { staffId: req.staff.id });
    let printWarning = null;
    if (getBooleanSetting(db, 'auto_print_kitchen', false) && getBooleanSetting(db, 'printer_enabled', false)) {
      try {
        await printOrder(db, order, 'kitchen', { timeZone: config.timezone });
      } catch (error) {
        printWarning = error.message;
      }
    }
    res.json({ order, ...(printWarning ? { printWarning } : {}) });
  });

  api.post('/orders/:id/print/kitchen', requireRoles('admin', 'manager', 'cashier', 'server', 'kitchen'), async (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    await printOrder(db, getOrder(db, id), 'kitchen', { timeZone: config.timezone });
    res.json({ success: true });
  });

  api.post('/orders/:id/print/receipt', requireRoles('admin', 'manager', 'cashier', 'server'), async (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    await printOrder(db, getOrder(db, id), 'receipt', { timeZone: config.timezone });
    res.json({ success: true });
  });

  api.get('/kitchen/orders', requireRoles('admin', 'manager', 'kitchen'), (req, res) => {
    res.json({ tickets: getKitchenTickets(db) });
  });

  api.patch('/kitchen/items/:id', requireRoles('admin', 'manager', 'kitchen'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(kitchenItemUpdateSchema, req.body);
    res.json({ result: updateKitchenItem(db, id, input.status, req.staff.id) });
  });

  api.patch('/kitchen/orders/:id', requireRoles('admin', 'manager', 'kitchen'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(kitchenTicketUpdateSchema, req.body);
    res.json({ order: updateKitchenTicket(db, id, input.status, req.staff.id) });
  });

  api.get('/shifts/current', requireRoles('admin', 'manager', 'cashier', 'server'), (req, res) => {
    const shift = getOpenShift(db);
    res.json(shift ? getShiftSummary(db, shift.id) : { shift: null, totals: null });
  });

  api.get('/shifts', requireRoles('admin', 'manager', 'cashier'), (req, res) => {
    const rows = db
      .prepare(`
        SELECT s.id FROM shifts s
        ORDER BY s.opened_at DESC
        LIMIT 30
      `)
      .all()
      .map((row) => getShiftSummary(db, row.id));
    res.json({ shifts: rows });
  });

  api.get('/shifts/:id', requireRoles('admin', 'manager', 'cashier'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    res.json(getShiftSummary(db, id));
  });

  api.post('/shifts/open', requireRoles('admin', 'manager', 'cashier'), (req, res) => {
    const input = parseOrThrow(shiftOpenSchema, req.body);
    res.status(201).json(openShift(db, req.staff.id, input.openingCents, input.notes));
  });

  api.post('/shifts/:id/close', requireRoles('admin', 'manager', 'cashier'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(shiftCloseSchema, req.body);
    res.json(closeShift(db, id, req.staff.id, input.countedCents, input.notes));
  });

  api.get('/modifier-groups', requireRoles('admin', 'manager'), (req, res) => {
    res.json({ groups: listModifierGroups(db, { includeInactive: true }) });
  });

  api.post('/modifier-groups', requireRoles('admin', 'manager'), (req, res) => {
    const input = parseOrThrow(modifierGroupCreateSchema, req.body);
    res.status(201).json({ group: createModifierGroup(db, input) });
  });

  api.patch('/modifier-groups/:id', requireRoles('admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(modifierGroupUpdateSchema, req.body);
    res.json({ group: updateModifierGroup(db, id, input) });
  });

  api.put('/admin/products/:id/modifier-groups', requireRoles('admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(productModifierGroupsSchema, req.body);
    res.json({ groups: setProductModifierGroups(db, id, input.groupIds) });
  });

  api.get('/reports/daily', requireRoles('admin', 'manager', 'cashier'), (req, res) => {
    const { date } = parseOrThrow(dateQuerySchema, req.query);
    assertValidDate(date);
    res.json(getDailyReport(db, config, date));
  });

  api.get('/reports/daily.csv', requireRoles('admin', 'manager', 'cashier'), (req, res) => {
    const { date } = parseOrThrow(dateQuerySchema, req.query);
    assertValidDate(date);
    const report = getDailyReport(db, config, date);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${report.date}.csv"`);
    res.send(dailyReportCsv(report));
  });

  api.get('/admin/categories', requireRoles('admin', 'manager'), (req, res) => {
    res.json({ categories: listAdminCategories(db) });
  });

  api.post('/admin/categories', requireRoles('admin', 'manager'), (req, res) => {
    const input = parseOrThrow(categoryCreateSchema, req.body);
    res.status(201).json({ category: createCategory(db, input) });
  });

  api.patch('/admin/categories/:id', requireRoles('admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(categoryUpdateSchema, req.body);
    res.json({ category: updateCategory(db, id, input) });
  });

  api.get('/admin/products', requireRoles('admin', 'manager'), (req, res) => {
    res.json({ products: listAdminProducts(db) });
  });

  api.post('/admin/products', requireRoles('admin', 'manager'), (req, res) => {
    const input = parseOrThrow(productCreateSchema, req.body);
    res.status(201).json({ product: createProduct(db, input) });
  });

  api.patch('/admin/products/:id', requireRoles('admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(productUpdateSchema, req.body);
    res.json({ product: updateProduct(db, id, input) });
  });

  api.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Ruta de API no encontrada.' },
    });
  });

  app.use('/api', api);

  app.use((req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Recurso no encontrado.' },
    });
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

    if (error instanceof AppError) {
      return res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }

    if (error?.type === 'entity.too.large') {
      return res.status(413).json({
        error: { code: 'PAYLOAD_TOO_LARGE', message: 'La solicitud es demasiado grande.' },
      });
    }

    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({
        error: { code: 'INVALID_JSON', message: 'El cuerpo de la solicitud no es JSON válido.' },
      });
    }

    if (/UNIQUE constraint failed/i.test(error?.message ?? '')) {
      return res.status(409).json({
        error: { code: 'CONFLICT', message: 'La operación entra en conflicto con datos existentes.' },
      });
    }

    console.error('[api] Error no controlado:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado. Intenta de nuevo.' },
    });
  });

  return app;
}
