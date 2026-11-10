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

async function request(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    cache: 'no-store',
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
  getHealth: () => request('/health'),
  getCatalog: () => request('/catalog'),
  getTables: () => request('/tables'),
  getOrders: (params) => request(`/orders${queryString(params)}`),
  getOrder: (id) => request(`/orders/${id}`),
  createOrder: (body) => request('/orders', { method: 'POST', body }),
  updateDraft: (id, body) => request(`/orders/${id}/draft`, { method: 'PATCH', body }),
  payOrder: (id, body) => request(`/orders/${id}/pay`, { method: 'POST', body }),
  cancelOrder: (id) => request(`/orders/${id}/cancel`, { method: 'POST', body: {} }),
  getDailyReport: (date) => request(`/reports/daily${queryString({ date })}`),
  getAdminCategories: () => request('/admin/categories'),
  createCategory: (body) => request('/admin/categories', { method: 'POST', body }),
  updateCategory: (id, body) => request(`/admin/categories/${id}`, { method: 'PATCH', body }),
  getAdminProducts: () => request('/admin/products'),
  createProduct: (body) => request('/admin/products', { method: 'POST', body }),
  updateProduct: (id, body) => request(`/admin/products/${id}`, { method: 'PATCH', body }),
};
