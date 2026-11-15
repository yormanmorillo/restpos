import { randomUUID } from 'node:crypto';
import { getCatalog } from './catalog.js';
import { createOrder, updateOrderDraft, cancelOrder, getOrder } from './orders.js';
import { getBooleanSetting, getSetting, publicFeatures } from './settings.js';
import { parseOrThrow, publicOrderSchema, publicTableOrderSchema } from './validation.js';
import { findTableByToken, createQrTableOrder } from './qr-orders.js';
import { featureEnabled } from './features.js';
import { AppError, conflict, notFound } from './errors.js';
import { imageFilePath } from './uploads.js';

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ORDERS = 6;

function rateLimit(req) {
  const key = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return;
  }
  if (entry.count >= MAX_ORDERS) {
    throw new AppError(429, 'TOO_MANY_ORDERS', 'Demasiados pedidos. Intenta más tarde.');
  }
  entry.count += 1;
}

export function registerPublicRoutes(router, db, config) {
  router.get('/public/product-images/:filename', (req, res, next) => {
    const file = imageFilePath(config.uploadsPath, 'products', req.params.filename);
    if (!file) return next(notFound('No se encontró la imagen.'));
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.sendFile(file, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });

  router.get('/public/receipts/:token', (req, res, next) => {
    const { token } = req.params;
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return next(notFound('No se encontró la factura.'));
    const row = db
      .prepare("SELECT id FROM orders WHERE public_receipt_token = ? AND status = 'pagada'")
      .get(token);
    if (!row) return next(notFound('No se encontró la factura.'));
    const order = getOrder(db, Number(row.id));
    return res.json({
      receipt: {
        restaurantName: getSetting(db, 'restaurant_name', 'Casa Roble'),
        orderNumber: order.orderNumber,
        businessDate: order.businessDate,
        paidAt: order.paidAt,
        serviceType: order.serviceType,
        tableName: order.tableName,
        customerName: order.customerName || '',
        items: order.items.map((item) => ({
          id: item.id,
          productName: item.productName,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          lineTotalCents: item.lineTotalCents,
          notes: item.notes,
          modifiers: (item.modifiers ?? []).map((modifier) => modifier.modifierName),
        })),
        subtotalCents: order.subtotalCents,
        discountCents: order.discountCents,
        taxRateBps: order.taxRateBps,
        taxCents: order.taxCents,
        tipCents: order.tipCents,
        deliveryFeeCents: order.deliveryFeeCents,
        totalCents: order.totalCents,
        payments: order.payments.map((payment) => ({
          methodName: payment.paymentMethodName,
          amountCents: payment.amountCents,
        })),
        currency: config.currency,
        timezone: config.timezone,
      },
    });
  });

  router.get('/public/tables/:token', (req, res) => {
    if (!featureEnabled(db, 'qr_table_order')) throw notFound('No se encontró la mesa.');
    const table = findTableByToken(db, req.params.token);
    const catalog = getCatalog(db, config);
    const openOrder = db.prepare("SELECT id, order_number FROM orders WHERE table_id = ? AND status = 'abierta'").get(table.id);
    res.json({
      restaurant: { name: getSetting(db, 'restaurant_name', 'Casa Roble'), currency: config.currency, taxRateBps: config.taxRateBps },
      table: { id: Number(table.id), name: table.name, areaName: table.area_name ?? null },
      categories: catalog.categories,
      openOrder: openOrder ? { id: Number(openOrder.id), orderNumber: openOrder.order_number } : null,
    });
  });

  router.post('/public/tables/:token/orders', (req, res) => {
    if (!featureEnabled(db, 'qr_table_order')) throw notFound('No se encontró la mesa.');
    rateLimit(req);
    const input = parseOrThrow(publicTableOrderSchema, req.body);
    const { table, orderId } = createQrTableOrder(db, config, req.params.token, input);
    const order = getOrder(db, orderId);
    res.status(201).json({ table: { id: Number(table.id), name: table.name }, order: { id: order.id, orderNumber: order.orderNumber, totalCents: order.totalCents, status: order.status } });
  });

  router.get('/public/checks/:token', (req, res) => {
    const check = db.prepare('SELECT * FROM order_checks WHERE public_receipt_token = ?').get(req.params.token);
    if (!check) throw notFound('No se encontró el ticket de la cuenta.');
    const order = getOrder(db, Number(check.order_id));
    const serialized = order.checks.find((entry) => Number(entry.id) === Number(check.id));
    if (!serialized) throw notFound('No se encontró el ticket de la cuenta.');
    res.json({
      receipt: {
        restaurantName: getSetting(db, 'restaurant_name', 'Casa Roble'),
        orderNumber: order.orderNumber,
        checkLabel: serialized.label,
        customerName: order.customerName,
        businessDate: order.businessDate,
        paidAt: serialized.paidAt,
        timezone: config.timezone,
        currency: config.currency,
        taxRateBps: order.taxRateBps,
        items: serialized.lines,
        subtotalCents: serialized.subtotalCents,
        discountCents: serialized.discountCents,
        taxCents: serialized.taxCents,
        deliveryFeeCents: serialized.deliveryCents,
        tipCents: serialized.tipCents,
        totalCents: serialized.totalCents,
        payments: serialized.payments,
      },
    });
  });

  router.get('/public/restaurant', (req, res) => {
    const features = publicFeatures(db);
    if (!getBooleanSetting(db, 'online_ordering_enabled', false)) {
      return res.status(403).json({
        error: {
          code: 'ONLINE_ORDERING_DISABLED',
          message: 'Los pedidos en línea no están disponibles por el momento.',
        },
        features,
      });
    }
    const catalog = getCatalog(db, config);
    const categories = catalog.categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        products: category.products
          .filter((product) => product.active && product.priceCents >= 0)
          .map((product) => ({
            id: product.id,
            categoryId: product.categoryId,
            categoryName: category.name,
            name: product.name,
            description: product.description,
            priceCents: product.priceCents,
            imageUrl: product.imageUrl ?? null,
            modifierGroups: product.modifierGroups ?? [],
          })),
      }))
      .filter((category) => category.products.length > 0);
    return res.json({
      restaurant: {
        name: features.restaurantName || getSetting(db, 'restaurant_name', 'Casa Roble'),
        currency: config.currency,
        taxRateBps: config.taxRateBps,
      },
      features,
      categories,
    });
  });

  router.post('/public/orders', (req, res) => {
    if (!getBooleanSetting(db, 'online_ordering_enabled', false)) {
      return res.status(403).json({
        error: {
          code: 'ONLINE_ORDERING_DISABLED',
          message: 'Los pedidos en línea no están disponibles por el momento.',
        },
      });
    }
    rateLimit(req);
    const input = parseOrThrow(publicOrderSchema, req.body);
    if (input.fulfillment === 'pickup' && !getBooleanSetting(db, 'online_pickup_enabled', true)) {
      throw conflict('La recolección en restaurante no está disponible.');
    }
    if (input.fulfillment === 'delivery' && !getBooleanSetting(db, 'online_delivery_enabled', true)) {
      throw conflict('La entrega a domicilio no está disponible.');
    }
    const delivery = input.fulfillment === 'delivery';
    let created = null;
    try {
      created = createOrder(db, config, {
        type: 'llevar',
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        notes: input.notes,
        delivery,
        deliveryAddress: delivery ? input.deliveryAddress : '',
        scheduledFor: input.scheduledFor ?? null,
        source: 'online',
        staffId: null,
      });
      const order = updateOrderDraft(
        db,
        config,
        created.id,
        {
          items: input.items.map((item) => ({
            clientKey: `line-${randomUUID()}`,
            productId: item.productId,
            quantity: item.quantity,
            notes: item.notes ?? '',
            modifiers: item.modifiers ?? [],
            course: item.course ?? 1,
          })),
          discountType: 'none',
          discountValue: 0,
          tipType: 'none',
          tipValue: 0,
        },
        { staffId: null },
      );
      res.status(201).json({
        order: {
          orderNumber: order.orderNumber,
          totalCents: order.totalCents,
          subtotalCents: order.subtotalCents,
          taxCents: order.taxCents,
          status: order.status,
          fulfillment: delivery ? 'delivery' : 'pickup',
        },
      });
    } catch (error) {
      if (created) {
        try {
          cancelOrder(db, created.id, { staffId: null });
        } catch {
          // El pedido incompleto no se cobrará; queda como abierto solo si falla la limpieza.
        }
      }
      throw error;
    }
  });
}
