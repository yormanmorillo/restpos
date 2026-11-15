import net from 'node:net';
import { AppError, notFound, validationError } from './errors.js';
import { getBooleanSetting, getSetting, isAllowedPrinterHost } from './settings.js';

const WIDTH = 42;
const INIT = Buffer.from([0x1b, 0x40]);
const BOLD_ON = Buffer.from([0x1b, 0x45, 0x01]);
const BOLD_OFF = Buffer.from([0x1b, 0x45, 0x00]);
const ALIGN_LEFT = Buffer.from([0x1b, 0x61, 0x00]);
const ALIGN_CENTER = Buffer.from([0x1b, 0x61, 0x01]);
const DOUBLE_ON = Buffer.from([0x1d, 0x21, 0x11]);
const DOUBLE_OFF = Buffer.from([0x1d, 0x21, 0x00]);
const CUT = Buffer.from([0x1d, 0x56, 0x00]);

function ascii(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\n]/g, '');
}

function money(cents, currency = 'CRC') {
  const amount = (Number(cents) / 100).toFixed(2);
  return currency === 'CRC' ? `CRC ${amount}` : `$${amount}`;
}

function wrap(text, width = WIDTH) {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > width) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = `${line} ${word}`.trim();
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

function line(left, right, width = WIDTH) {
  const leftText = ascii(left);
  const rightText = ascii(right);
  const spaces = Math.max(1, width - leftText.length - rightText.length);
  return `${leftText}${' '.repeat(spaces)}${rightText}`;
}

function rule(width = WIDTH) {
  return '-'.repeat(width);
}

function orderOrigin(order) {
  if (order.type === 'mesa') return `COMER AQUI / ${order.tableName ?? order.tableId}`;
  if (order.delivery) return 'DELIVERY';
  return 'PARA LLEVAR';
}

function timeLabel(value, timeZone) {
  return new Date(value).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

export function buildKitchenTicket(order, { timeZone, width = WIDTH } = {}) {
  const lines = [];
  lines.push(rule(width));
  lines.push('COCINA');
  lines.push(rule(width));
  lines.push(line(`Pedido ${order.orderNumber}`, timeLabel(order.kitchenSentAt ?? order.createdAt, timeZone), width));
  lines.push(orderOrigin(order));
  if (order.customerName) lines.push(`Cliente: ${order.customerName}`);
  if (order.delivery && order.deliveryAddress) lines.push(`Direccion: ${order.deliveryAddress}`);
  lines.push(rule(width));
  for (const item of order.items.filter((entry) => ['sent', 'preparing'].includes(entry.status))) {
    const sent = Number(item.sentQuantity ?? item.quantity);
    const addition = sent > 0 && sent < Number(item.quantity) ? Number(item.quantity) - sent : 0;
    lines.push(addition > 0 ? `+${addition} x ${item.productName} (adicional)` : `${item.quantity} x ${item.productName}`);
    for (const modifier of item.modifiers ?? []) {
      lines.push(`   + ${modifier.modifierName}`);
    }
    if (item.notes) lines.push(`   NOTA: ${item.notes}`);
  }
  lines.push(rule(width));
  if (order.notes) lines.push(`Nota general: ${order.notes}`);
  return ascii(lines.join('\n')) + '\n\n\n';
}

export function buildReceipt(order, { timeZone, width = WIDTH, restaurant = {}, currency = 'CRC' } = {}) {
  const lines = [];
  lines.push(String(restaurant.name || 'RESTAURANTE').toUpperCase());
  if (restaurant.tagline) lines.push(restaurant.tagline);
  if (restaurant.address) for (const row of wrap(restaurant.address, width)) lines.push(row);
  if (restaurant.phone) lines.push(`Tel. ${restaurant.phone}`);
  lines.push(rule(width));
  lines.push(line(`Ticket: ${order.orderNumber}`, order.businessDate ?? '', width));
  lines.push(line(orderOrigin(order), timeLabel(order.paidAt ?? order.createdAt, timeZone), width));
  if (order.customerName) lines.push(`Cliente: ${order.customerName}`);
  if (order.customerPhone) lines.push(`Telefono: ${order.customerPhone}`);
  if (order.delivery && order.deliveryAddress) lines.push(`Direccion: ${order.deliveryAddress}`);
  lines.push(rule(width));
  for (const item of order.items) {
    for (const row of wrap(`${item.quantity} x ${item.productName}`, width)) lines.push(row);
    for (const modifier of item.modifiers ?? []) {
      for (const row of wrap(`+ ${modifier.modifierName}`, width - 3)) lines.push(`   ${row}`);
    }
    if (item.notes) {
      for (const row of wrap(item.notes, width - 3)) lines.push(`   ${row}`);
    }
    lines.push(line('', money(item.lineTotalCents, currency), width));
  }
  lines.push(rule(width));
  lines.push(line('Subtotal', money(order.subtotalCents, currency), width));
  if (order.discountCents > 0) lines.push(line('Descuento', `-${money(order.discountCents, currency)}`, width));
  lines.push(line(`Impuesto (${order.taxRateBps / 100}%)`, money(order.taxCents, currency), width));
  if (order.deliveryFeeCents > 0) lines.push(line('Entrega', money(order.deliveryFeeCents, currency), width));
  if (order.tipCents > 0) lines.push(line('Propina', money(order.tipCents, currency), width));
  lines.push(line('TOTAL', money(order.totalCents, currency), width));
  lines.push(rule(width));
  const payments = order.payments ?? [];
  if (payments.length > 0) {
    for (const payment of payments) lines.push(line(payment.paymentMethodName || payment.paymentMethod, money(payment.amountCents, currency), width));
    const cash = payments.reduce((sum, payment) => sum + (payment.cashReceivedCents ?? 0), 0);
    const change = payments.reduce((sum, payment) => sum + (payment.changeCents ?? 0), 0);
    if (cash > 0) {
      lines.push(line('Efectivo recibido', money(cash, currency), width));
      lines.push(line('Cambio', money(change, currency), width));
    }
  }
  lines.push('');
  lines.push('Gracias por su visita');
  return ascii(lines.join('\n')) + '\n\n\n';
}

function escposDocument(text) {
  return Buffer.concat([
    INIT,
    ALIGN_LEFT,
    Buffer.from(ascii(text), 'ascii'),
    CUT,
  ]);
}

export function printerConfig(db, kind) {
  if (!getBooleanSetting(db, 'printer_enabled', false)) {
    throw validationError('La impresión térmica no está habilitada.');
  }
  if (getSetting(db, 'printer_connection', 'network') !== 'network') {
    throw validationError('La impresión está configurada para el navegador. Usa “Imprimir” en el ticket.');
  }
  const host = getSetting(db, `${kind}_printer_host`, '').trim();
  const port = Number(getSetting(db, `${kind}_printer_port`, '9100'));
  if (!host) throw validationError(`Configura la impresora de ${kind === 'kitchen' ? 'cocina' : 'tickets'}.`);
  const allowedHosts = getSetting(db, 'printer_allowed_hosts', '');
  if (host.length > 255 || !isAllowedPrinterHost(host, allowedHosts) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw validationError('La configuración de la impresora no es válida.');
  }
  return { host, port };
}

export function sendToPrinter({ host, port, data, timeoutMs = 4000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.write(data, (error) => {
        if (error) finish(error);
        else socket.end();
      });
    });
    socket.once('close', () => finish());
    socket.once('timeout', () => finish(new AppError(504, 'PRINTER_TIMEOUT', 'La impresora no respondió.')));
    socket.once('error', () => finish(new AppError(502, 'PRINTER_ERROR', 'No se pudo conectar con la impresora. Revisa la IP, el puerto y la red.')));
  });
}

export function printOrder(db, order, kind, { timeZone } = {}) {
  if (!order) throw notFound('No se encontró el pedido.');
  const config = printerConfig(db, kind);
  const paperWidth = Number(getSetting(db, 'printer_paper_width_mm', '80')) === 58 ? 32 : 42;
  const restaurant = {
    name: getSetting(db, 'restaurant_name', 'Restaurante'),
    tagline: getSetting(db, 'restaurant_tagline', ''),
    address: getSetting(db, 'restaurant_address', ''),
    phone: getSetting(db, 'restaurant_phone', ''),
  };
  const text = kind === 'kitchen'
    ? buildKitchenTicket(order, { timeZone, width: paperWidth })
    : buildReceipt(order, { timeZone, width: paperWidth, restaurant, currency: getSetting(db, 'currency', 'CRC') });
  return sendToPrinter({ ...config, data: escposDocument(text) });
}
