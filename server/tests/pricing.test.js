import { describe, expect, it } from 'vitest';
import {
  calculateTotals,
  calculateChange,
  calculateLineTotal,
  getSuggestedCashAmounts,
} from '@restpos/shared/pricing';
import {
  parseMoneyToCents,
  parsePercentToBps,
  formatMoney,
  formatPercentBps,
  centsToInput,
} from '@restpos/shared/money';

describe('motor de precios', () => {
  it('calcula subtotal y 16% de impuesto en centavos', () => {
    const totals = calculateTotals({
      items: [{ unitPriceCents: 8900, quantity: 2 }],
      taxRateBps: 1600,
    });
    expect(totals.subtotalCents).toBe(17800);
    expect(totals.taxCents).toBe(2848);
    expect(totals.tipCents).toBe(0);
    expect(totals.totalCents).toBe(20648);
  });

  it('redondea impuestos al centavo más cercano (half-up)', () => {
    const totals = calculateTotals({
      items: [{ unitPriceCents: 9990, quantity: 1 }],
      taxRateBps: 1600,
    });
    expect(totals.taxCents).toBe(1598);
    expect(totals.totalCents).toBe(11588);
  });

  it('aplica descuento porcentual antes del impuesto y propina después', () => {
    const totals = calculateTotals({
      items: [{ unitPriceCents: 8900, quantity: 2 }],
      discountType: 'percent',
      discountValue: 1000,
      taxRateBps: 1600,
      tipType: 'percent',
      tipValue: 1500,
    });
    expect(totals.subtotalCents).toBe(17800);
    expect(totals.discountCents).toBe(1780);
    expect(totals.taxableBaseCents).toBe(16020);
    expect(totals.taxCents).toBe(2563);
    expect(totals.preTipTotalCents).toBe(18583);
    expect(totals.tipCents).toBe(2787);
    expect(totals.totalCents).toBe(21370);
  });

  it('limita un descuento fijo al subtotal y admite propina fija', () => {
    const totals = calculateTotals({
      items: [{ unitPriceCents: 5000, quantity: 1 }],
      discountType: 'fixed',
      discountValue: 8000,
      tipType: 'fixed',
      tipValue: 1000,
    });
    expect(totals.subtotalCents).toBe(5000);
    expect(totals.discountCents).toBe(5000);
    expect(totals.taxCents).toBe(0);
    expect(totals.tipCents).toBe(1000);
    expect(totals.totalCents).toBe(1000);
  });

  it('no acumula errores de punto flotante en muchas líneas', () => {
    const totals = calculateTotals({
      items: [
        { unitPriceCents: 333, quantity: 3 },
        { unitPriceCents: 101, quantity: 7 },
        { unitPriceCents: 999, quantity: 1 },
      ],
      taxRateBps: 1600,
    });
    expect(totals.subtotalCents).toBe(2705);
    expect(totals.taxCents).toBe(433);
    expect(totals.totalCents).toBe(3138);
  });

  it('calcula cambio en efectivo y rechaza efectivo insuficiente', () => {
    expect(calculateChange(21370, 30000)).toBe(8630);
    expect(calculateChange(21370, 21370)).toBe(0);
    expect(() => calculateChange(21370, 20000)).toThrow(/no alcanza/i);
  });

  it('valida cantidades y precios de línea', () => {
    expect(calculateLineTotal(8900, 3)).toBe(26700);
    expect(() => calculateLineTotal(8900, 0)).toThrow(/cantidad/i);
    expect(() => calculateLineTotal(8900, 100)).toThrow(/cantidad/i);
    expect(() => calculateLineTotal(-1, 1)).toThrow(/negativo/i);
    expect(() => calculateTotals({ items: [], discountValue: 0, taxRateBps: -1 })).toThrow(/tasa/i);
    expect(() => calculateTotals({ items: [], tipType: 'percent', tipValue: 10001 })).toThrow(/100%/i);
  });

  it('sugiere montos de efectivo rápidos no menores al total', () => {
    const suggestions = getSuggestedCashAmounts(17804);
    expect(suggestions).toContain(17804);
    expect(suggestions.every((amount) => amount >= 17804)).toBe(true);
    expect(suggestions).toContain(20000);
  });
});

describe('utilidades de dinero', () => {
  it('convierte texto a centavos sin aritmética flotante', () => {
    expect(parseMoneyToCents('89')).toBe(8900);
    expect(parseMoneyToCents('89.5')).toBe(8950);
    expect(parseMoneyToCents('89,05')).toBe(8905);
    expect(parseMoneyToCents('$1,234.56')).toBe(123456);
    expect(parseMoneyToCents('0')).toBe(0);
    expect(() => parseMoneyToCents('89.999')).toThrow(/2 decimales/i);
    expect(() => parseMoneyToCents('-5')).toThrow(/monto válido/i);
    expect(() => parseMoneyToCents('abc')).toThrow(/monto válido/i);
    expect(() => parseMoneyToCents('0', { allowZero: false })).toThrow(/mayor que cero/i);
  });

  it('convierte porcentajes a puntos base y valida el rango', () => {
    expect(parsePercentToBps('10')).toBe(1000);
    expect(parsePercentToBps('10.5%')).toBe(1050);
    expect(parsePercentToBps('100')).toBe(10000);
    expect(() => parsePercentToBps('100.01')).toThrow(/entre 0 y 100/i);
    expect(formatPercentBps(1000)).toBe('10%');
    expect(formatPercentBps(1050)).toBe('10.5%');
  });

  it('formatea moneda y edición de precios', () => {
    expect(formatMoney(21370)).toContain('213,70');
    expect(centsToInput(8900)).toBe('89.00');
  });
});
