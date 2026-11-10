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
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
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
  getTables: () => request('/tables'),
  getAreas: () => request('/areas'),
  getOrders: (params) => request(`/orders${queryString(params)}`),
  getOrder: (id) => request(`/orders/${id}`),
  createOrder: (body) => request('/orders', { method: 'POST', body }),
  updateDraft: (id, body) => request(`/orders/${id}/draft`, { method: 'PATCH', body }),
  sendToKitchen: (id) => request(`/orders/${id}/send-kitchen`, { method: 'POST', body: {} }),
  payOrder: (id, body) => request(`/orders/${id}/pay`, { method: 'POST', body }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'POST', body: {} }),
  printOrder: (id, kind) => request(`/orders/${id}/print/${kind}`, { method: 'POST', body: {} }),
  getDailyReport: (date) => request(`/reports/daily${queryString({ date })}`),
  getDailyReportCsvUrl: (date) => `/api/reports/daily.csv${queryString({ date })}`,

  getKitchenTickets: () => request('/kitchen/orders'),
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
  setProductModifierGroups: (id, groupIds) => request(`/admin/products/${id}/modifier-groups`, { method: 'PUT', body: { groupIds } }),

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
  createPublicOrder: (body) => request('/public/orders', { method: 'POST', body, skipUnauthorizedEvent: true }),
};
