import express from 'express';
import multer from 'multer';
import { AppError, notFound, validationError } from './errors.js';
import { audit } from './audit.js';
import {
  registerAuthRoutes,
  authenticate,
  requireRoles,
  createStaff,
  updateStaff,
  listStaff,
  findManagerByPin,
} from './auth.js';
import { getSettings, updateSettings, safeFeatures, filterSettingsForRole } from './settings.js';
import { registerPublicRoutes } from './public.js';
import { getCatalog } from './catalog.js';
import { assertCanCharge } from './permissions.js';
import { listTables, createOrder, getOrder, updateOrderDraft, payOrder, cancelOrder, closeCourtesyOrder, refundOrder, listOrders, sendOrderToKitchen, ensureReceiptToken } from './orders.js';
import { getDailyReport, dailyReportCsv } from './reports.js';
import { getBooleanSetting, getSetting } from './settings.js';
import { printOrder } from './printer.js';
import { getKitchenTickets, updateKitchenItem, updateKitchenTicket } from './kitchen.js';
import { listKitchenStations, createKitchenStation, updateKitchenStation } from './kitchen-stations.js';
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
  photoIdParamsSchema,
  orderPaymentParamsSchema,
  createOrderSchema,
  draftSchema,
  payOrderSchema,
  courtesySchema,
  refundSchema,
  splitCreateSchema,
  moveTableSchema,
  offlineSaleSchema,
  mergeOrderSchema,
  transferItemsSchema,
  kitchenStationCreateSchema,
  kitchenStationUpdateSchema,
  customerCreateSchema,
  customerUpdateSchema,
  giftCardCreateSchema,
  giftCardUpdateSchema,
  promotionCreateSchema,
  promotionUpdateSchema,
  applyPromotionSchema,
  reservationCreateSchema,
  reservationUpdateSchema,
  waitlistCreateSchema,
  waitlistUpdateSchema,
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
  paymentMethodCreateSchema,
  paymentMethodUpdateSchema,
  paymentMethodToggleSchema,
  integrationCreateSchema,
  integrationUpdateSchema,
  inventoryItemCreateSchema,
  inventoryItemUpdateSchema,
  inventoryReceiptSchema,
  inventoryAdjustmentSchema,
  recipeSchema,
} from './validation.js';
import { listAreas, createArea, updateArea, listAdminTables, createTable, updateTable } from './areas.js';
import { listPaymentMethods, createPaymentMethod, updatePaymentMethod, findPaymentMethod } from './payment-methods.js';
import { listIntegrations, createIntegration, updateIntegration } from './integrations.js';
import { listInventoryItems, createInventoryItem, updateInventoryItem, receiveInventory, adjustInventory, listInventoryMovements, listRecipes, saveRecipe } from './inventory.js';
import { importProducts } from './product-import.js';
import { requireFeature } from './features.js';
import { createOrderSplits, clearOrderSplits } from './splits.js';
import { moveOrderToTable, mergeOrders, transferItems } from './table-ops.js';
import { createOfflineSale } from './offline.js';
import { listGiftCards, findGiftCard, createGiftCard, updateGiftCard } from './gift-cards.js';
import { listPromotions, createPromotion, updatePromotion, applyPromotion, removePromotion } from './promotions.js';
import { listReservations, createReservation, updateReservation, listWaitlist, createWaitlistEntry, updateWaitlistEntry } from './reservations.js';
import { listCustomers, getCustomer, createCustomer, updateCustomer } from './customers.js';
import { serializeProduct } from './serializers.js';
import { ALLOWED_IMAGE_TYPES, saveImageFile, imageFilePath, removeImageFile } from './uploads.js';

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!/\.csv$/i.test(file.originalname) && !['text/csv', 'text/plain', 'application/vnd.ms-excel'].includes(file.mimetype)) {
      callback(new AppError(422, 'INVALID_FILE', 'Sube un archivo CSV.'));
      return;
    }
    callback(null, true);
  },
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 4 },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      callback(new AppError(422, 'INVALID_IMAGE', 'La imagen debe ser JPG, PNG o WebP.'));
      return;
    }
    callback(null, true);
  },
});

function serializePaymentPhoto(photo) {
  return {
    id: Number(photo.id),
    url: `/api/payment-photos/${photo.id}`,
    mimeType: photo.mime_type,
    sizeBytes: Number(photo.size_bytes),
    createdAt: photo.created_at,
  };
}

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxyHops ?? 0);
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
    res.json({ features: safeFeatures(db) });
  });

  api.get('/promotions', requireFeature(db, 'promotions'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ promotions: listPromotions(db) });
  });

  api.post('/promotions', requireFeature(db, 'promotions'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(promotionCreateSchema, req.body);
    res.status(201).json({ promotion: createPromotion(db, input, req.staff.id) });
  });

  api.patch('/promotions/:id', requireFeature(db, 'promotions'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(promotionUpdateSchema, req.body);
    res.json({ promotion: updatePromotion(db, id, input, req.staff.id) });
  });

  api.post('/orders/:id/promotion', requireFeature(db, 'promotions'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(applyPromotionSchema, req.body);
    applyPromotion(db, id, input.code, req.staff.id);
    res.json({ order: getOrder(db, id) });
  });

  api.delete('/orders/:id/promotion', requireFeature(db, 'promotions'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    removePromotion(db, id, req.staff.id);
    res.json({ order: getOrder(db, id) });
  });

  api.get('/gift-cards', requireFeature(db, 'gift_cards'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    res.json({ giftCards: listGiftCards(db) });
  });

  api.get('/gift-cards/:code', requireFeature(db, 'gift_cards'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const card = findGiftCard(db, req.params.code);
    if (!card) throw new AppError(404, 'NOT_FOUND', 'No se encontró la gift card.');
    res.json({ giftCard: card });
  });

  api.post('/gift-cards', requireFeature(db, 'gift_cards'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(giftCardCreateSchema, req.body);
    res.status(201).json({ giftCard: createGiftCard(db, input, req.staff.id) });
  });

  api.patch('/gift-cards/:id', requireFeature(db, 'gift_cards'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(giftCardUpdateSchema, req.body);
    res.json({ giftCard: updateGiftCard(db, id, input, req.staff.id) });
  });

  api.get('/reservations', requireFeature(db, 'reservations'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    res.json({ reservations: listReservations(db, { date: req.query.date ?? null, status: req.query.status ?? null }) });
  });

  api.post('/reservations', requireFeature(db, 'reservations'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const input = parseOrThrow(reservationCreateSchema, req.body);
    res.status(201).json({ reservation: createReservation(db, input, req.staff.id) });
  });

  api.patch('/reservations/:id', requireFeature(db, 'reservations'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(reservationUpdateSchema, req.body);
    res.json({ reservation: updateReservation(db, id, input, req.staff.id) });
  });

  api.get('/waitlist', requireFeature(db, 'reservations'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    res.json({ entries: listWaitlist(db, { status: req.query.status ?? 'waiting' }) });
  });

  api.post('/waitlist', requireFeature(db, 'reservations'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const input = parseOrThrow(waitlistCreateSchema, req.body);
    res.status(201).json({ entry: createWaitlistEntry(db, input, req.staff.id) });
  });

  api.patch('/waitlist/:id', requireFeature(db, 'reservations'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(waitlistUpdateSchema, req.body);
    res.json({ entry: updateWaitlistEntry(db, id, input.status, req.staff.id) });
  });

  api.get('/customers', requireFeature(db, 'customers_loyalty'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    res.json({ customers: listCustomers(db, { query: req.query.q ?? '', limit: req.query.limit }) });
  });

  api.get('/customers/:id', requireFeature(db, 'customers_loyalty'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    res.json({ customer: getCustomer(db, id) });
  });

  api.post('/customers', requireFeature(db, 'customers_loyalty'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const input = parseOrThrow(customerCreateSchema, req.body);
    res.status(201).json({ customer: createCustomer(db, input, req.staff.id) });
  });

  api.patch('/customers/:id', requireFeature(db, 'customers_loyalty'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(customerUpdateSchema, req.body);
    res.json({ customer: updateCustomer(db, id, input, req.staff.id) });
  });

  api.get('/catalog', (req, res) => {
    res.json(getCatalog(db, config));
  });

  api.get('/tables', (req, res) => {
    res.json({ tables: listTables(db) });
  });

  api.get('/admin/tables', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ tables: listAdminTables(db) });
  });

  api.post('/admin/tables', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(tableCreateSchema, req.body);
    res.status(201).json({ table: createTable(db, input) });
  });

  api.patch('/admin/tables/:id', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(tableUpdateSchema, req.body);
    res.json({ table: updateTable(db, id, input) });
  });

  api.get('/staff', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ staff: listStaff(db) });
  });

  api.post('/staff', requireRoles('owner', 'admin'), (req, res) => {
    const input = parseOrThrow(staffCreateSchema, req.body);
    res.status(201).json({ staff: createStaff(db, input, req.staff.id, req.staff.role) });
  });

  api.patch('/staff/:id', requireRoles('owner', 'admin'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(staffUpdateSchema, req.body);
    res.json({ staff: updateStaff(db, id, input, req.staff.id, req.staff.role) });
  });

  api.get('/settings', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ settings: filterSettingsForRole(getSettings(db), req.staff.role) });
  });

  api.patch('/settings', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(settingsUpdateSchema, req.body);
    const printerNetworkKeys = Object.keys(input.settings).filter((key) => key.endsWith('_printer_host') || key.endsWith('_printer_port') || key === 'printer_allowed_hosts');
    if (printerNetworkKeys.length > 0 && req.staff.role !== 'owner') {
      for (const key of printerNetworkKeys) delete input.settings[key];
    }
    if (req.staff.role !== 'owner') {
      for (const key of Object.keys(input.settings)) {
        if (key.startsWith('feature_')) delete input.settings[key];
      }
    }
    const saved = Object.keys(input.settings).length > 0 ? updateSettings(db, input.settings) : getSettings(db);
    res.json({ settings: filterSettingsForRole(saved, req.staff.role) });
  });

  api.get('/payment-methods', (req, res) => {
    res.json({ methods: listPaymentMethods(db) });
  });

  api.post('/payment-methods', requireRoles('owner'), (req, res) => {
    const input = parseOrThrow(paymentMethodCreateSchema, req.body);
    res.status(201).json({ method: createPaymentMethod(db, input, req.staff.id) });
  });

  api.patch('/payment-methods/:id', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = req.staff.role === 'owner'
      ? parseOrThrow(paymentMethodUpdateSchema, req.body)
      : parseOrThrow(paymentMethodToggleSchema, req.body);
    res.json({ method: updatePaymentMethod(db, id, input, req.staff.id) });
  });

  api.get('/payment-photos/:photoId', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res, next) => {
    const { photoId } = parseOrThrow(photoIdParamsSchema, req.params);
    const photo = db.prepare('SELECT * FROM payment_photos WHERE id = ?').get(photoId);
    if (!photo) return next(notFound('No se encontró el comprobante.'));
    const file = imageFilePath(config.uploadsPath, 'payments', photo.filename);
    if (!file) return next(notFound('No se encontró el archivo del comprobante.'));
    res.setHeader('Content-Type', photo.mime_type);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(file, (error) => {
      if (error && !res.headersSent) next(error);
    });
  });

  api.post('/orders/:id/payments/:paymentId/photos', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), upload.array('photos', 4), (req, res) => {
    const { id, paymentId } = parseOrThrow(orderPaymentParamsSchema, req.params);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ? AND order_id = ?').get(paymentId, id);
    if (!payment) throw notFound('No se encontró el pago.');
    const method = findPaymentMethod(db, payment.payment_method);
    if (!method?.allowsPhoto) {
      throw validationError('Este método de pago no permite adjuntar comprobantes.');
    }
    if (!req.files || req.files.length === 0) {
      throw validationError('Selecciona al menos una foto.');
    }
    const currentCount = Number(
      db.prepare('SELECT COUNT(*) AS count FROM payment_photos WHERE payment_id = ?').get(paymentId).count,
    );
    if (currentCount + req.files.length > 6) {
      throw validationError('Puedes adjuntar hasta 6 fotos por pago.');
    }
    const inserted = [];
    const saved = [];
    const now = new Date().toISOString();
    try {
      for (const file of req.files) {
        const filename = saveImageFile(file, config.uploadsPath, 'payments');
        saved.push(filename);
        const result = db.prepare(`
          INSERT INTO payment_photos
            (payment_id, filename, mime_type, size_bytes, uploaded_by_staff_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(paymentId, filename, file.mimetype, file.size, req.staff.id, now);
        inserted.push(serializePaymentPhoto({
          id: result.lastInsertRowid,
          mime_type: file.mimetype,
          size_bytes: file.size,
          created_at: now,
        }));
      }
    } catch (error) {
      for (const photo of inserted) db.prepare('DELETE FROM payment_photos WHERE id = ?').run(photo.id);
      for (const filename of saved) removeImageFile(config.uploadsPath, 'payments', filename);
      throw error;
    }
    audit(db, req.staff.id, 'payment.photos.upload', 'payment', Number(paymentId), {
      orderId: Number(id),
      count: inserted.length,
    });
    res.status(201).json({ photos: inserted });
  });

  api.delete('/payment-photos/:photoId', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { photoId } = parseOrThrow(photoIdParamsSchema, req.params);
    const photo = db.prepare('SELECT * FROM payment_photos WHERE id = ?').get(photoId);
    if (!photo) throw notFound('No se encontró el comprobante.');
    db.prepare('DELETE FROM payment_photos WHERE id = ?').run(photoId);
    removeImageFile(config.uploadsPath, 'payments', photo.filename);
    audit(db, req.staff.id, 'payment.photos.delete', 'payment', Number(photo.payment_id), { photoId: Number(photoId) });
    res.json({ success: true });
  });

  api.get('/inventory/items', requireFeature(db, 'inventory'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ items: listInventoryItems(db) });
  });

  api.post('/inventory/items', requireFeature(db, 'inventory'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(inventoryItemCreateSchema, req.body);
    res.status(201).json({ item: createInventoryItem(db, input, req.staff.id) });
  });

  api.patch('/inventory/items/:id', requireFeature(db, 'inventory'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(inventoryItemUpdateSchema, req.body);
    res.json({ item: updateInventoryItem(db, id, input, req.staff.id) });
  });

  api.post('/inventory/items/:id/receipts', requireFeature(db, 'inventory'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(inventoryReceiptSchema, req.body);
    res.status(201).json(receiveInventory(db, id, input, req.staff.id));
  });

  api.post('/inventory/items/:id/adjustments', requireFeature(db, 'inventory'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(inventoryAdjustmentSchema, req.body);
    res.json({ item: adjustInventory(db, id, input, req.staff.id) });
  });

  api.get('/inventory/movements', requireFeature(db, 'inventory'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const itemId = req.query.itemId ? Number(req.query.itemId) : null;
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    res.json({ movements: listInventoryMovements(db, { itemId: Number.isInteger(itemId) && itemId > 0 ? itemId : null, limit }) });
  });

  api.get('/inventory/recipes', requireFeature(db, 'inventory'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ recipes: listRecipes(db) });
  });

  api.put('/inventory/recipes/:productId', requireFeature(db, 'inventory'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id: productId } = parseOrThrow(idParamsSchema, { id: req.params.productId });
    const input = parseOrThrow(recipeSchema, req.body);
    res.json({ recipe: saveRecipe(db, productId, input.ingredients, req.staff.id) });
  });

  api.get('/integrations', requireFeature(db, 'integrations'), requireRoles('owner'), (req, res) => {
    res.json({ integrations: listIntegrations(db) });
  });

  api.post('/integrations', requireFeature(db, 'integrations'), requireRoles('owner'), (req, res) => {
    const input = parseOrThrow(integrationCreateSchema, req.body);
    res.status(201).json({ integration: createIntegration(db, input, req.staff.id) });
  });

  api.patch('/integrations/:id', requireFeature(db, 'integrations'), requireRoles('owner'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(integrationUpdateSchema, req.body);
    res.json({ integration: updateIntegration(db, id, input, req.staff.id) });
  });

  api.get('/areas', (req, res) => {
    res.json({ areas: listAreas(db) });
  });

  api.post('/areas', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(areaCreateSchema, req.body);
    res.status(201).json({ area: createArea(db, input) });
  });

  api.patch('/areas/:id', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(areaUpdateSchema, req.body);
    res.json({ area: updateArea(db, id, input) });
  });

  api.get('/orders', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const query = parseOrThrow(orderListQuerySchema, req.query);
    assertValidDate(query.date);
    res.json(listOrders(db, query));
  });

  api.get('/orders/:id', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    res.json({ order: getOrder(db, id) });
  });

  api.post('/orders', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const input = parseOrThrow(createOrderSchema, req.body);
    const order = createOrder(db, config, input, { staffId: req.staff.id });
    res.status(201).json({ order });
  });

  api.patch('/orders/:id/draft', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(draftSchema, req.body);
    res.json({ order: updateOrderDraft(db, config, id, input, { staffId: req.staff.id, staffRole: req.staff.role }) });
  });

  api.post('/orders/:id/pay', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    assertCanCharge(db, req.staff);
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(payOrderSchema, req.body);
    res.json({ order: payOrder(db, config, id, input, { staffId: req.staff.id }) });
  });

  api.delete('/orders/:id/splits', requireFeature(db, 'split_bill'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    clearOrderSplits(db, id, req.staff.id);
    res.json({ order: getOrder(db, id) });
  });

  api.post('/offline/sales', requireFeature(db, 'offline_mode'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const input = parseOrThrow(offlineSaleSchema, req.body);
    res.status(201).json({ order: createOfflineSale(db, config, input, req.staff.id) });
  });

  api.post('/orders/:id/move', requireFeature(db, 'table_transfer_merge'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(moveTableSchema, req.body);
    moveOrderToTable(db, id, input.tableId, req.staff.id);
    res.json({ order: getOrder(db, id) });
  });

  api.post('/orders/:id/transfer-items', requireFeature(db, 'table_transfer_merge'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(transferItemsSchema, req.body);
    transferItems(db, id, input.targetOrderId, input.itemIds, req.staff.id);
    res.json({ order: getOrder(db, id), targetOrder: getOrder(db, input.targetOrderId) });
  });

  api.post('/orders/:id/merge', requireFeature(db, 'table_transfer_merge'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(mergeOrderSchema, req.body);
    mergeOrders(db, id, input.sourceOrderId, req.staff.id);
    res.json({ order: getOrder(db, id) });
  });

  api.post('/orders/:id/splits', requireFeature(db, 'split_bill'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(splitCreateSchema, req.body);
    const splits = createOrderSplits(db, id, input.groups, req.staff.id);
    res.status(201).json({ splits, order: getOrder(db, id) });
  });

  api.post('/orders/:id/refund', requireFeature(db, 'refunds'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(refundSchema, req.body);
    const authorizer = findManagerByPin(db, input.managerPin);
    if (!authorizer) throw new AppError(403, 'INVALID_MANAGER_PIN', 'PIN de gerente incorrecto.');
    res.json({ order: refundOrder(db, config, id, { reason: input.reason, amountCents: input.amountCents, authorizedById: authorizer.id, staffId: req.staff.id }) });
  });

  api.post('/orders/:id/courtesy', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(courtesySchema, req.body);
    res.json({ order: closeCourtesyOrder(db, config, id, { reason: input.reason, staffId: req.staff.id }) });
  });

  api.post('/orders/:id/cancel', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    res.json({ order: cancelOrder(db, id, { staffId: req.staff.id }) });
  });

  api.post('/orders/:id/send-kitchen', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), async (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const { order, kitchenSnapshot } = sendOrderToKitchen(db, id, { staffId: req.staff.id });
    let printWarning = null;
    if (getBooleanSetting(db, 'auto_print_kitchen', false) && getBooleanSetting(db, 'printer_enabled', false) && getSetting(db, 'printer_connection', 'network') === 'network') {
      try {
        await printOrder(db, kitchenSnapshot ?? order, 'kitchen', { timeZone: config.timezone });
      } catch (error) {
        printWarning = error.message;
      }
    }
    res.json({ order, ...(printWarning ? { printWarning } : {}) });
  });

  api.get('/orders/:id/share', requireFeature(db, 'whatsapp_receipt'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const order = ensureReceiptToken(db, id);
    const restaurantName = getSetting(db, 'restaurant_name', 'Casa Roble');
    const currency = getSetting(db, 'currency', 'CRC');
    const symbol = currency === 'CRC' ? '₡' : '$';
    const message = `${restaurantName} · Pedido ${order.orderNumber}\nTotal: ${symbol}${(order.totalCents / 100).toFixed(2)}\nGracias por su visita.`;
    res.json({ url: order.publicReceiptUrl, message, orderNumber: order.orderNumber });
  });

  api.post('/orders/:id/print/kitchen', requireRoles('owner', 'admin', 'manager', 'cashier', 'server', 'kitchen'), async (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    await printOrder(db, getOrder(db, id), 'kitchen', { timeZone: config.timezone });
    res.json({ success: true });
  });

  api.post('/orders/:id/print/receipt', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), async (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    await printOrder(db, getOrder(db, id), 'receipt', { timeZone: config.timezone });
    res.json({ success: true });
  });

  api.get('/kitchen/stations', requireFeature(db, 'kitchen_stations'), requireRoles('owner', 'admin', 'manager', 'cashier', 'server', 'kitchen'), (req, res) => {
    res.json({ stations: listKitchenStations(db, { activeOnly: true }) });
  });

  api.get('/admin/kitchen-stations', requireFeature(db, 'kitchen_stations'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ stations: listKitchenStations(db) });
  });

  api.post('/admin/kitchen-stations', requireFeature(db, 'kitchen_stations'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(kitchenStationCreateSchema, req.body);
    res.status(201).json({ station: createKitchenStation(db, input) });
  });

  api.patch('/admin/kitchen-stations/:id', requireFeature(db, 'kitchen_stations'), requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(kitchenStationUpdateSchema, req.body);
    res.json({ station: updateKitchenStation(db, id, input) });
  });

  api.get('/kitchen/orders', requireRoles('owner', 'admin', 'manager', 'cashier', 'server', 'kitchen'), (req, res) => {
    const stationId = req.query.stationId ? Number(req.query.stationId) : null;
    res.json({ tickets: getKitchenTickets(db, { stationId: Number.isInteger(stationId) && stationId > 0 ? stationId : null }) });
  });

  api.patch('/kitchen/items/:id', requireRoles('owner', 'admin', 'manager', 'cashier', 'server', 'kitchen'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(kitchenItemUpdateSchema, req.body);
    res.json({ result: updateKitchenItem(db, id, input.status, req.staff.id) });
  });

  api.patch('/kitchen/orders/:id', requireRoles('owner', 'admin', 'manager', 'cashier', 'server', 'kitchen'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(kitchenTicketUpdateSchema, req.body);
    res.json({ order: updateKitchenTicket(db, id, input.status, req.staff.id) });
  });

  api.get('/shifts/current', requireRoles('owner', 'admin', 'manager', 'cashier', 'server'), (req, res) => {
    const shift = getOpenShift(db);
    res.json(shift ? getShiftSummary(db, shift.id) : { shift: null, totals: null });
  });

  api.get('/shifts', requireRoles('owner', 'admin', 'manager', 'cashier'), (req, res) => {
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

  api.get('/shifts/:id', requireRoles('owner', 'admin', 'manager', 'cashier'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    res.json(getShiftSummary(db, id));
  });

  api.post('/shifts/open', requireRoles('owner', 'admin', 'manager', 'cashier'), (req, res) => {
    const input = parseOrThrow(shiftOpenSchema, req.body);
    res.status(201).json(openShift(db, req.staff.id, input.openingCents, input.notes));
  });

  api.post('/shifts/:id/close', requireRoles('owner', 'admin', 'manager', 'cashier'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(shiftCloseSchema, req.body);
    res.json(closeShift(db, id, req.staff.id, input.countedCents, input.notes));
  });

  api.get('/modifier-groups', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ groups: listModifierGroups(db, { includeInactive: true }) });
  });

  api.post('/modifier-groups', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(modifierGroupCreateSchema, req.body);
    res.status(201).json({ group: createModifierGroup(db, input) });
  });

  api.patch('/modifier-groups/:id', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(modifierGroupUpdateSchema, req.body);
    res.json({ group: updateModifierGroup(db, id, input) });
  });

  api.put('/admin/products/:id/modifier-groups', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(productModifierGroupsSchema, req.body);
    res.json({ groups: setProductModifierGroups(db, id, input.groupIds) });
  });

  api.get('/reports/daily', requireRoles('owner', 'admin', 'manager', 'cashier'), (req, res) => {
    const { date } = parseOrThrow(dateQuerySchema, req.query);
    assertValidDate(date);
    res.json(getDailyReport(db, config, date));
  });

  api.get('/reports/daily.csv', requireRoles('owner', 'admin', 'manager', 'cashier'), (req, res) => {
    const { date } = parseOrThrow(dateQuerySchema, req.query);
    assertValidDate(date);
    const report = getDailyReport(db, config, date);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="reporte-${report.date}.csv"`);
    res.send(dailyReportCsv(report));
  });

  api.get('/admin/categories', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ categories: listAdminCategories(db) });
  });

  api.post('/admin/categories', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(categoryCreateSchema, req.body);
    res.status(201).json({ category: createCategory(db, input) });
  });

  api.patch('/admin/categories/:id', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(categoryUpdateSchema, req.body);
    res.json({ category: updateCategory(db, id, input) });
  });

  api.get('/admin/products', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    res.json({ products: listAdminProducts(db) });
  });

  api.post('/admin/products', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const input = parseOrThrow(productCreateSchema, req.body);
    res.status(201).json({ product: createProduct(db, input) });
  });

  api.patch('/admin/products/:id', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const input = parseOrThrow(productUpdateSchema, req.body);
    res.json({ product: updateProduct(db, id, input) });
  });

  api.post('/admin/products/import', requireFeature(db, 'bulk_import'), requireRoles('owner', 'admin', 'manager'), csvUpload.single('file'), (req, res) => {
    if (!req.file) throw validationError('Selecciona un archivo CSV.');
    const text = req.file.buffer.toString('utf8');
    res.json({ result: importProducts(db, text, req.staff.id) });
  });

  api.post('/admin/products/:id/image', requireRoles('owner', 'admin', 'manager'), upload.single('image'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const existing = db
      .prepare(`
        SELECT p.*, c.name AS category_name
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?
      `)
      .get(id);
    if (!existing) throw notFound('No se encontró el producto.');
    if (!req.file) throw validationError('Selecciona una imagen.');
    const filename = saveImageFile(req.file, config.uploadsPath, 'products');
    try {
      db.prepare('UPDATE products SET image_path = ?, updated_at = ? WHERE id = ?')
        .run(filename, new Date().toISOString(), id);
    } catch (error) {
      removeImageFile(config.uploadsPath, 'products', filename);
      throw error;
    }
    if (existing.image_path) removeImageFile(config.uploadsPath, 'products', existing.image_path);
    audit(db, req.staff.id, 'product.image.upload', 'product', Number(id), { filename });
    const updated = db
      .prepare(`
        SELECT p.*, c.name AS category_name
        FROM products p JOIN categories c ON c.id = p.category_id
        WHERE p.id = ?
      `)
      .get(id);
    res.json({ product: serializeProduct(updated) });
  });

  api.delete('/admin/products/:id/image', requireRoles('owner', 'admin', 'manager'), (req, res) => {
    const { id } = parseOrThrow(idParamsSchema, req.params);
    const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    if (!existing) throw notFound('No se encontró el producto.');
    db.prepare("UPDATE products SET image_path = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    if (existing.image_path) removeImageFile(config.uploadsPath, 'products', existing.image_path);
    audit(db, req.staff.id, 'product.image.delete', 'product', Number(id), {});
    res.json({ success: true });
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

    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Cada imagen debe pesar menos de 6 MB.'
        : error.code === 'LIMIT_FILE_COUNT'
          ? 'Puedes subir hasta 4 imágenes por solicitud.'
          : 'No se pudo procesar la imagen.';
      return res.status(413).json({ error: { code: 'UPLOAD_ERROR', message } });
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
