import net from 'node:net';
import { AppError, notFound, validationError } from './errors.js';
import { getBooleanSetting, getSetting } from './settings.js';

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

function money(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
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
  if (order.type === 'mesa') return `Mesa: ${order.tableName ?? order.tableId}`;
  if (order.delivery) return 'PARA LLEVAR / DELIVERY';
  return 'PARA LLEVAR';
}

function timeLabel(value, timeZone) {
  return new Date(value).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}

export function buildKitchenTicket(order, { timeZone } = {}) {
  const lines = [];
  lines.push(rule());
  lines.push('COCINA');
  lines.push(rule());
  lines.push(line(`Pedido ${order.orderNumber}`, timeLabel(order.kitchenSentAt ?? order.createdAt, timeZone)));
  lines.push(orderOrigin(order));
  if (order.customerName) lines.push(`Cliente: ${order.customerName}`);
  if (order.delivery && order.deliveryAddress) lines.push(`Direccion: ${order.deliveryAddress}`);
  lines.push(rule());
  for (const item of order.items.filter((entry) => ['sent', 'preparing'].includes(entry.status))) {
    lines.push(`${item.quantity} x ${item.productName}`);
    for (const modifier of item.modifiers ?? []) {
      lines.push(`   + ${modifier.modifierName}`);
    }
    if (item.notes) lines.push(`   NOTA: ${item.notes}`);
  }
  lines.push(rule());
  if (order.notes) lines.push(`Nota general: ${order.notes}`);
  return ascii(lines.join('\n')) + '\n\n\n';
}

export function buildReceipt(order, { timeZone } = {}) {
  const lines = [];
  lines.push('CASA ROBLE');
  lines.push('Cocina de la casa');
  lines.push('Av. Reforma 123, Centro, CDMX');
  lines.push('Tel. 55 1234 5678');
  lines.push(rule());
  lines.push(line(`Ticket: ${order.orderNumber}`, order.businessDate ?? ''));
  lines.push(line(orderOrigin(order), timeLabel(order.paidAt ?? order.createdAt, timeZone)));
  if (order.customerName) lines.push(`Cliente: ${order.customerName}`);
  if (order.customerPhone) lines.push(`Telefono: ${order.customerPhone}`);
  if (order.delivery && order.deliveryAddress) lines.push(`Direccion: ${order.deliveryAddress}`);
  lines.push(rule());
  for (const item of order.items) {
    lines.push(`${item.quantity} x ${item.productName}`);
    for (const modifier of item.modifiers ?? []) lines.push(`   + ${modifier.modifierName}`);
    if (item.notes) lines.push(`   ${item.notes}`);
    lines.push(line('', money(item.lineTotalCents)));
  }
  lines.push(rule());
  lines.push(line('Subtotal', money(order.subtotalCents)));
  if (order.discountCents > 0) lines.push(line('Descuento', `-${money(order.discountCents)}`));
  lines.push(line(`Impuesto (${order.taxRateBps / 100}%)`, money(order.taxCents)));
  if (order.deliveryFeeCents > 0) lines.push(line('Entrega', money(order.deliveryFeeCents)));
  if (order.tipCents > 0) lines.push(line('Propina', money(order.tipCents)));
  lines.push(line('TOTAL', money(order.totalCents)));
  lines.push(rule());
  const payments = order.payments ?? [];
  if (payments.length > 0) {
    for (const payment of payments) lines.push(line(payment.paymentMethod, money(payment.amountCents)));
    const cash = payments.reduce((sum, payment) => sum + (payment.cashReceivedCents ?? 0), 0);
    const change = payments.reduce((sum, payment) => sum + (payment.changeCents ?? 0), 0);
    if (cash > 0) {
      lines.push(line('Efectivo recibido', money(cash)));
      lines.push(line('Cambio', money(change)));
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
  const host = getSetting(db, `${kind}_printer_host`, '').trim();
  const port = Number(getSetting(db, `${kind}_printer_port`, '9100'));
  if (!host) throw validationError(`Configura la impresora de ${kind === 'kitchen' ? 'cocina' : 'tickets'}.`);
  if (host.length > 255 || !Number.isInteger(port) || port < 1 || port > 65535) {
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
    socket.once('error', (error) => finish(new AppError(502, 'PRINTER_ERROR', `No se pudo imprimir: ${error.message}`)));
  });
}

export function printOrder(db, order, kind, { timeZone } = {}) {
  if (!order) throw notFound('No se encontró el pedido.');
  const config = printerConfig(db, kind);
  const text = kind === 'kitchen'
    ? buildKitchenTicket(order, { timeZone })
    : buildReceipt(order, { timeZone });
  return sendToPrinter({ ...config, data: escposDocument(text) });
}
