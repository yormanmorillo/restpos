import { formatMoney } from '@restpos/shared/money';

export { formatMoney };

const PAYMENT_LABELS = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  sinpe: 'SINPE Móvil',
  transferencia: 'Transferencia bancaria',
  otro: 'Otro',
};

export function paymentLabel(method) {
  return PAYMENT_LABELS[method] ?? 'Sin pago';
}

export function formatTime(isoString, timeZone) {
  if (!isoString) return '';
  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(isoString));
}

export function formatBusinessDate(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}

export function productQtyInOrder(order, productId) {
  return order.items
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + item.quantity, 0);
}

export function serviceLabel(order) {
  if (!order) return '';
  if (order.serviceType === 'delivery' || order.delivery) return 'Delivery';
  if (order.serviceType === 'dine_in' || order.type === 'mesa') {
    return order.tableName ? `Comer aquí · ${order.tableName}` : 'Comer aquí';
  }
  return 'Para llevar';
}

export function serviceShortLabel(order) {
  if (!order) return '';
  if (order.serviceType === 'delivery' || order.delivery) return 'Delivery';
  if (order.serviceType === 'dine_in' || order.type === 'mesa') return 'Comer aquí';
  return 'Para llevar';
}

export function statusLabel(status) {
  return {
    pending: 'Por enviar',
    sent: 'Enviado',
    preparing: 'Preparando',
    ready: 'Listo',
    served: 'Servido',
  }[status] ?? status;
}
