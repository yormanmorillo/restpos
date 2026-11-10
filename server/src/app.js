import express from 'express';
import { AppError } from './errors.js';
import { getCatalog } from './catalog.js';
import { listTables, createOrder, getOrder, updateOrderDraft, payOrder, cancelOrder, listOrders } from './orders.js';
import { getDailyReport } from './reports.js';
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
} from './validation.js';

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
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

  api.get('/catalog', (req, res) => {
    res.json(getCatalog(db, config));
  });

  api.get('/tables', (req, res) => {
    res.json({ tables: listTables(db) });
  });

  api.get('/orders', (req, res) => {
    const query = parseOrThrow(orderListQuerySchema, req.query);
    assertValidDate(query.date);
    res.json(listOrders(db, query));
  });

  api.get('/orders/:id', (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    res.json({ order: getOrder(db, id) });
  });

  api.post('/orders', (req, res) => {
    const input = parseOrThrow(createOrderSchema, req.body);
    const order = createOrder(db, config, input);
    res.status(201).json({ order });
  });

  api.patch('/orders/:id/draft', (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(draftSchema, req.body);
    res.json({ order: updateOrderDraft(db, config, id, input) });
  });

  api.post('/orders/:id/pay', (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(payOrderSchema, req.body);
    res.json({ order: payOrder(db, config, id, input) });
  });

  api.post('/orders/:id/cancel', (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    res.json({ order: cancelOrder(db, id) });
  });

  api.get('/reports/daily', (req, res) => {
    const { date } = parseOrThrow(dateQuerySchema, req.query);
    assertValidDate(date);
    res.json(getDailyReport(db, config, date));
  });

  api.get('/admin/categories', (req, res) => {
    res.json({ categories: listAdminCategories(db) });
  });

  api.post('/admin/categories', (req, res) => {
    const input = parseOrThrow(categoryCreateSchema, req.body);
    res.status(201).json({ category: createCategory(db, input) });
  });

  api.patch('/admin/categories/:id', (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(categoryUpdateSchema, req.body);
    res.json({ category: updateCategory(db, id, input) });
  });

  api.get('/admin/products', (req, res) => {
    res.json({ products: listAdminProducts(db) });
  });

  api.post('/admin/products', (req, res) => {
    const input = parseOrThrow(productCreateSchema, req.body);
    res.status(201).json({ product: createProduct(db, input) });
  });

  api.patch('/admin/products/:id', (req, res) => {
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
