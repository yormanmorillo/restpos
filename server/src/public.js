import { randomUUID } from 'node:crypto';
import { getCatalog } from './catalog.js';
import { createOrder, updateOrderDraft, cancelOrder } from './orders.js';
import { getBooleanSetting, getSetting, publicFeatures } from './settings.js';
import { parseOrThrow, publicOrderSchema } from './validation.js';
import { AppError, conflict } from './errors.js';

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
