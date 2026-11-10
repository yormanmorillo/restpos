/**
 * Motor de precios autoritativo. No usa números flotantes para acumular dinero:
 * los precios y cantidades son enteros y los porcentajes se expresan en puntos base.
 */
import { assertInteger } from './money.js';

export const DEFAULT_TAX_RATE_BPS = 1600; // 16 %
export const MAX_PERCENT_BPS = 10000; // 100 %
export const MAX_ITEM_QUANTITY = 99;
export const MAX_LINE_ITEMS = 100;
export const MAX_PRICE_CENTS = 1_000_000; // $10,000.00

const DISCOUNT_TYPES = new Set(['none', 'percent', 'fixed']);
const TIP_TYPES = new Set(['none', 'percent', 'fixed']);

function roundHalfUp(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new TypeError('No se pudo redondear el importe.');
  }
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

export function calculateLineTotal(unitPriceCents, quantity) {
  assertInteger(unitPriceCents, 'unitPriceCents');
  assertInteger(quantity, 'quantity');
  if (unitPriceCents < 0) throw new RangeError('El precio no puede ser negativo.');
  if (quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
    throw new RangeError(`La cantidad debe estar entre 1 y ${MAX_ITEM_QUANTITY}.`);
  }
  const total = unitPriceCents * quantity;
  if (!Number.isSafeInteger(total)) throw new RangeError('El importe de la línea es demasiado grande.');
  return total;
}

function normalizeAdjustment(type, value, allowedTypes, label) {
  if (!allowedTypes.has(type)) {
    throw new RangeError(`${label}: tipo inválido.`);
  }
  assertInteger(value, `${label.toLowerCase()}Value`);
  if (value < 0) throw new RangeError(`${label}: el valor no puede ser negativo.`);
  if (type === 'none') return { type, value: 0, cents: 0 };
  if (type === 'percent') {
    if (value > MAX_PERCENT_BPS) {
      throw new RangeError(`${label}: el porcentaje no puede superar 100%.`);
    }
    return { type, value, cents: null };
  }
  return { type, value, cents: value };
}

export function calculateTotals({
  items = [],
  discountType = 'none',
  discountValue = 0,
  tipType = 'none',
  tipValue = 0,
  taxRateBps = DEFAULT_TAX_RATE_BPS,
} = {}) {
  if (!Array.isArray(items)) throw new TypeError('items debe ser un arreglo.');
  if (items.length > MAX_LINE_ITEMS) {
    throw new RangeError(`El pedido no puede tener más de ${MAX_LINE_ITEMS} líneas.`);
  }
  assertInteger(taxRateBps, 'taxRateBps');
  if (taxRateBps < 0 || taxRateBps > MAX_PERCENT_BPS) {
    throw new RangeError('La tasa de impuesto debe estar entre 0% y 100%.');
  }

  const discount = normalizeAdjustment(discountType, discountValue, DISCOUNT_TYPES, 'Descuento');
  const tip = normalizeAdjustment(tipType, tipValue, TIP_TYPES, 'Propina');

  let subtotalCents = 0;
  const lineTotals = items.map((item, index) => {
    const unitPriceCents = item.unitPriceCents ?? item.priceCents;
    const lineTotalCents = calculateLineTotal(unitPriceCents, item.quantity);
    subtotalCents += lineTotalCents;
    if (!Number.isSafeInteger(subtotalCents)) {
      throw new RangeError('El subtotal es demasiado grande.');
    }
    return { index, lineTotalCents };
  });

  let discountCents = 0;
  if (discount.type === 'percent') {
    discountCents = roundHalfUp(subtotalCents * discount.value, MAX_PERCENT_BPS);
  } else if (discount.type === 'fixed') {
    discountCents = Math.min(discount.cents, subtotalCents);
  }
  discountCents = Math.min(discountCents, subtotalCents);
  const taxableBaseCents = subtotalCents - discountCents;
  const taxCents = roundHalfUp(taxableBaseCents * taxRateBps, MAX_PERCENT_BPS);
  const preTipTotalCents = taxableBaseCents + taxCents;
  const tipCents =
    tip.type === 'percent'
      ? roundHalfUp(preTipTotalCents * tip.value, MAX_PERCENT_BPS)
      : tip.cents;
  const totalCents = preTipTotalCents + tipCents;

  if (![subtotalCents, discountCents, taxCents, tipCents, totalCents].every(Number.isSafeInteger)) {
    throw new RangeError('El total del pedido es demasiado grande.');
  }

  return {
    lines: lineTotals,
    subtotalCents,
    discountCents,
    taxableBaseCents,
    taxCents,
    tipCents,
    totalCents,
    preTipTotalCents,
  };
}

export function calculateChange(totalCents, cashReceivedCents) {
  assertInteger(totalCents, 'totalCents');
  assertInteger(cashReceivedCents, 'cashReceivedCents');
  if (totalCents < 0 || cashReceivedCents < 0) {
    throw new RangeError('Los importes no pueden ser negativos.');
  }
  if (cashReceivedCents < totalCents) {
    throw new RangeError('El efectivo recibido no alcanza para cubrir el total.');
  }
  return cashReceivedCents - totalCents;
}

export function getSuggestedCashAmounts(totalCents) {
  assertInteger(totalCents, 'totalCents');
  if (totalCents < 0) throw new RangeError('El total no puede ser negativo.');
  const suggestions = new Set([totalCents]);
  for (const step of [5000, 10000, 20000, 50000, 100000]) {
    if (totalCents % step !== 0 || step >= totalCents) {
      suggestions.add(Math.ceil(totalCents / step) * step);
    }
  }
  return [...suggestions].filter((value) => value >= totalCents).sort((a, b) => a - b).slice(0, 6);
}
