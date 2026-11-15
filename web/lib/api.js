const API_PREFIX = '/api';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, skipUnauthorizedEvent = false } = {}) {
  const options = {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  };
  if (body !== undefined) {
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      options.body = body;
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
  }

  let response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, options);
  } catch {
    throw new ApiError('No se pudo conectar con el servidor. Verifica que la API esté corriendo.', {
      code: 'NETWORK_ERROR',
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError(`El servidor respondió con error ${response.status}.`, {
        status: response.status,
        code: 'INVALID_RESPONSE',
      });
    }
  }

  if (!response.ok) {
    if (response.status === 401 && !skipUnauthorizedEvent && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('restpos:unauthorized'));
    }
    const error = payload?.error;
    throw new ApiError(error?.message || 'No se pudo completar la operación.', {
      status: response.status,
      code: error?.code || 'API_ERROR',
      details: error?.details ?? null,
    });
  }
  return payload;
}

function queryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  getHealth: () => request('/health', { skipUnauthorizedEvent: true }),

  getAuthStatus: () => request('/auth/status', { skipUnauthorizedEvent: true }),
  getAuthOptions: () => request('/auth/options', { skipUnauthorizedEvent: true }),
  setupAdmin: (body) => request('/auth/setup', { method: 'POST', body, skipUnauthorizedEvent: true }),
  login: (body) => request('/auth/login', { method: 'POST', body, skipUnauthorizedEvent: true }),
  logout: () => request('/auth/logout', { method: 'POST', body: {}, skipUnauthorizedEvent: true }),
  getMe: () => request('/auth/me'),

  getFeatures: () => request('/features'),
  getCatalog: () => request('/catalog'),
  getGiftCards: () => request('/gift-cards'),
  getGiftCard: (code) => request(`/gift-cards/${encodeURIComponent(code)}`),
  createGiftCard: (body) => request('/gift-cards', { method: 'POST', body }),
  updateGiftCard: (id, body) => request(`/gift-cards/${id}`, { method: 'PATCH', body }),
  getReservations: (date) => request(`/reservations${queryString({ date })}`),
  createReservation: (body) => request('/reservations', { method: 'POST', body }),
  updateReservation: (id, body) => request(`/reservations/${id}`, { method: 'PATCH', body }),
  getWaitlist: () => request('/waitlist'),
  createWaitlistEntry: (body) => request('/waitlist', { method: 'POST', body }),
  updateWaitlistEntry: (id, status) => request(`/waitlist/${id}`, { method: 'PATCH', body: { status } }),
  getCustomers: (query) => request(`/customers${queryString({ q: query })}`),
  getCustomer: (id) => request(`/customers/${id}`),
  createCustomer: (body) => request('/customers', { method: 'POST', body }),
  updateCustomer: (id, body) => request(`/customers/${id}`, { method: 'PATCH', body }),
  getTables: () => request('/tables'),
  getAreas: () => request('/areas'),
  getOrders: (params) => request(`/orders${queryString(params)}`),
  getOrder: (id) => request(`/orders/${id}`),
  getOrderShare: (id) => request(`/orders/${id}/share`),
  createOrder: (body) => request('/orders', { method: 'POST', body }),
  updateDraft: (id, body) => request(`/orders/${id}/draft`, { method: 'PATCH', body }),
  sendToKitchen: (id) => request(`/orders/${id}/send-kitchen`, { method: 'POST', body: {} }),
  payOrder: (id, body) => request(`/orders/${id}/pay`, { method: 'POST', body }),
  closeCourtesy: (id, body) => request(`/orders/${id}/courtesy`, { method: 'POST', body }),
  splitOrder: (id, body) => request(`/orders/${id}/splits`, { method: 'POST', body }),
  clearSplits: (id) => request(`/orders/${id}/splits`, { method: 'DELETE' }),
  moveOrder: (id, body) => request(`/orders/${id}/move`, { method: 'POST', body }),
  mergeOrder: (id, body) => request(`/orders/${id}/merge`, { method: 'POST', body }),
  transferItems: (id, body) => request(`/orders/${id}/transfer-items`, { method: 'POST', body }),
  createOfflineSale: (body) => request('/offline/sales', { method: 'POST', body }),
  refundOrder: (id, body) => request(`/orders/${id}/refund`, { method: 'POST', body }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'POST', body: {} }),
  printOrder: (id, kind) => request(`/orders/${id}/print/${kind}`, { method: 'POST', body: {} }),
  getDailyReport: (date) => request(`/reports/daily${queryString({ date })}`),
  getDailyReportCsvUrl: (date) => `/api/reports/daily.csv${queryString({ date })}`,

  getKitchenTickets: (stationId) => request(`/kitchen/orders${queryString({ stationId })}`),
  getKitchenStations: () => request('/kitchen/stations'),
  getAdminKitchenStations: () => request('/admin/kitchen-stations'),
  createKitchenStation: (body) => request('/admin/kitchen-stations', { method: 'POST', body }),
  updateKitchenStation: (id, body) => request(`/admin/kitchen-stations/${id}`, { method: 'PATCH', body }),
  updateKitchenItem: (id, status) => request(`/kitchen/items/${id}`, { method: 'PATCH', body: { status } }),
  updateKitchenTicket: (id, status) => request(`/kitchen/orders/${id}`, { method: 'PATCH', body: { status } }),

  getCurrentShift: () => request('/shifts/current'),
  getShifts: () => request('/shifts'),
  getShift: (id) => request(`/shifts/${id}`),
  openShift: (body) => request('/shifts/open', { method: 'POST', body }),
  closeShift: (id, body) => request(`/shifts/${id}/close`, { method: 'POST', body }),

  getAdminCategories: () => request('/admin/categories'),
  createCategory: (body) => request('/admin/categories', { method: 'POST', body }),
  updateCategory: (id, body) => request(`/admin/categories/${id}`, { method: 'PATCH', body }),
  getAdminProducts: () => request('/admin/products'),
  createProduct: (body) => request('/admin/products', { method: 'POST', body }),
  updateProduct: (id, body) => request(`/admin/products/${id}`, { method: 'PATCH', body }),
  importProducts: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/admin/products/import', { method: 'POST', body: form });
  },
  setProductModifierGroups: (id, groupIds) => request(`/admin/products/${id}/modifier-groups`, { method: 'PUT', body: { groupIds } }),
  uploadProductImage: (id, file) => {
    const form = new FormData();
    form.append('image', file);
    return request(`/admin/products/${id}/image`, { method: 'POST', body: form });
  },
  deleteProductImage: (id) => request(`/admin/products/${id}/image`, { method: 'DELETE' }),

  getPaymentMethods: () => request('/payment-methods'),
  createPaymentMethod: (body) => request('/payment-methods', { method: 'POST', body }),
  updatePaymentMethod: (id, body) => request(`/payment-methods/${id}`, { method: 'PATCH', body }),
  getInventoryItems: () => request('/inventory/items'),
  createInventoryItem: (body) => request('/inventory/items', { method: 'POST', body }),
  updateInventoryItem: (id, body) => request(`/inventory/items/${id}`, { method: 'PATCH', body }),
  receiveInventory: (id, body) => request(`/inventory/items/${id}/receipts`, { method: 'POST', body }),
  adjustInventory: (id, body) => request(`/inventory/items/${id}/adjustments`, { method: 'POST', body }),
  getInventoryMovements: (params) => request(`/inventory/movements${queryString(params)}`),
  getRecipes: () => request('/inventory/recipes'),
  saveRecipe: (productId, ingredients) => request(`/inventory/recipes/${productId}`, { method: 'PUT', body: { ingredients } }),

  getIntegrations: () => request('/integrations'),
  createIntegration: (body) => request('/integrations', { method: 'POST', body }),
  updateIntegration: (id, body) => request(`/integrations/${id}`, { method: 'PATCH', body }),
  uploadPaymentPhotos: (orderId, paymentId, files) => {
    const form = new FormData();
    for (const file of files) form.append('photos', file);
    return request(`/orders/${orderId}/payments/${paymentId}/photos`, { method: 'POST', body: form });
  },
  deletePaymentPhoto: (photoId) => request(`/payment-photos/${photoId}`, { method: 'DELETE' }),

  getStaff: () => request('/staff'),
  createStaff: (body) => request('/staff', { method: 'POST', body }),
  updateStaff: (id, body) => request(`/staff/${id}`, { method: 'PATCH', body }),

  getModifierGroups: () => request('/modifier-groups'),
  createModifierGroup: (body) => request('/modifier-groups', { method: 'POST', body }),
  updateModifierGroup: (id, body) => request(`/modifier-groups/${id}`, { method: 'PATCH', body }),

  getSettings: () => request('/settings'),
  updateSettings: (settings) => request('/settings', { method: 'PATCH', body: { settings } }),

  createArea: (body) => request('/areas', { method: 'POST', body }),
  updateArea: (id, body) => request(`/areas/${id}`, { method: 'PATCH', body }),
  getAdminTables: () => request('/admin/tables'),
  createTable: (body) => request('/admin/tables', { method: 'POST', body }),
  updateTable: (id, body) => request(`/admin/tables/${id}`, { method: 'PATCH', body }),

  getPublicRestaurant: () => request('/public/restaurant', { skipUnauthorizedEvent: true }),
  getPublicReceipt: (token) => request(`/public/receipts/${token}`, { skipUnauthorizedEvent: true }),
  createPublicOrder: (body) => request('/public/orders', { method: 'POST', body, skipUnauthorizedEvent: true }),
};
