import { describe, expect, it } from 'vitest';
import { buildKitchenTicket, buildReceipt } from '../src/printer.js';

const order = {
  orderNumber: 'P-0042',
  type: 'llevar',
  delivery: true,
  customerName: 'Ana Pérez',
  customerPhone: '5512345678',
  deliveryAddress: 'Calle Roble 123, Centro',
  notes: 'Sin cubiertos',
  businessDate: '2026-11-09',
  paidAt: '2026-11-10T04:30:00.000Z',
  createdAt: '2026-11-10T04:00:00.000Z',
  kitchenSentAt: '2026-11-10T04:05:00.000Z',
  tableName: null,
  taxRateBps: 1600,
  subtotalCents: 20800,
  discountCents: 0,
  taxCents: 3328,
  deliveryFeeCents: 2500,
  tipCents: 0,
  totalCents: 26628,
  items: [
    {
      quantity: 2,
      productName: 'Guacamole con totopos',
      lineTotalCents: 20800,
      notes: 'Sin cebolla',
      status: 'sent',
      modifiers: [{ modifierName: 'Extra queso' }],
    },
  ],
  payments: [
    { paymentMethod: 'efectivo', amountCents: 26628, cashReceivedCents: 30000, changeCents: 3372 },
  ],
};

describe('documentos ESC/POS', () => {
  it('genera una comanda de cocina con platillos enviados y modificadores', () => {
    const ticket = buildKitchenTicket(order, { timeZone: 'America/Mexico_City' });
    expect(ticket).toContain('COCINA');
    expect(ticket).toContain('P-0042');
    expect(ticket).toContain('2 x Guacamole con totopos');
    expect(ticket).toContain('+ Extra queso');
    expect(ticket).toContain('NOTA: Sin cebolla');
    expect(ticket).toContain('Direccion: Calle Roble 123, Centro');
    expect(ticket).toContain('10:05 p.m.');
  });

  it('genera el ticket con entrega, pago y sin acentos problemáticos', () => {
    const receipt = buildReceipt(order, { timeZone: 'America/Mexico_City', currency: 'MXN' });
    expect(receipt).toContain('Cliente: Ana Perez');
    expect(receipt).toContain('Entrega');
    expect(receipt).toContain('$25.00');
    expect(receipt).toContain('TOTAL');
    expect(receipt).toContain('$266.28');
    expect(receipt).toContain('Efectivo recibido');
    expect(receipt).toContain('Cambio');
    const crc = buildReceipt(order, { timeZone: 'America/Costa_Rica', currency: 'CRC' });
    expect(crc).toContain('CRC 266.28');
  });
});
