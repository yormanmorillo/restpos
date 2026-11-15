/**
 * Utilidades monetarias compartidas por frontend y backend.
 * Todos los importes viajan y se calculan como enteros en centavos.
 */

const PERCENT_PATTERN = /^\d{1,3}(?:[.,]\d{1,2})?$/;


/**
 * Acepta "1234.56", "1,234.56", "1.234,56" y "1,234". La última coma o punto
 * se interpreta como separador decimal cuando le siguen una o dos cifras.
 */
function normalizeAmountSeparators(raw) {
  if (!/^\d[\d.,]*$/.test(raw)) return null;
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');

  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    const chunks = raw.split(decimalSep);
    if (chunks.length !== 2) return null;
    const integerPart = chunks[0].split(thousandsSep).join('');
    if (!/^\d+$/.test(integerPart) || !/^\d{1,2}$/.test(chunks[1])) return null;
    return `${integerPart}.${chunks[1]}`;
  }

  if (lastComma !== -1) {
    const chunks = raw.split(',');
    if (chunks.length === 2 && chunks[1].length <= 2) {
      return `${chunks[0]}.${chunks[1]}`;
    }
    if (/^\d{1,3}(?:,\d{3})+$/.test(raw)) return raw.replaceAll(',', '');
    return null;
  }

  if (lastDot !== -1) {
    const chunks = raw.split('.');
    if (chunks.length === 2) return raw;
    if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) return raw.replaceAll('.', '');
    return null;
  }

  return raw;
}

export function formatMoney(cents, { currency = 'CRC', locale = 'es-CR' } = {}) {
  assertInteger(cents, 'cents');
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function formatPercentBps(bps) {
  assertInteger(bps, 'bps');
  const percent = bps / 100;
  const text = Number.isInteger(percent)
    ? String(percent)
    : percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${text}%`;
}

/**
 * Convierte texto introducido por el usuario ("89", "89.5", "89,50")
 * a centavos sin pasar por aritmética de punto flotante.
 */
export function parseMoneyToCents(input, { allowZero = true } = {}) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new Error('El monto es obligatorio.');
  }
  const raw = String(input).trim().replace(/\s/g, '').replace(/[$₡]/g, '');
  if (!raw) throw new Error('Usa un monto válido con hasta 2 decimales.');
  const normalized = normalizeAmountSeparators(raw);
  if (!normalized || !/^\d{1,9}(?:\.\d{0,2})?$/.test(normalized)) {
    throw new Error('Usa un monto válido con hasta 2 decimales.');
  }
  const [wholePart, decimalPart = ''] = normalized.split('.');
  const cents = Number(wholePart) * 100 + Number(decimalPart.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) {
    throw new Error('El monto es demasiado grande.');
  }
  if (!allowZero && cents === 0) {
    throw new Error('El monto debe ser mayor que cero.');
  }
  return cents;
}

/**
 * Convierte un porcentaje de texto ("10", "10.5") a puntos base (1050).
 */
export function parsePercentToBps(input) {
  if (typeof input !== 'string' && typeof input !== 'number') {
    throw new Error('El porcentaje es obligatorio.');
  }
  const raw = String(input).trim().replace(/\s/g, '').replace(/%/g, '');
  if (!raw || !PERCENT_PATTERN.test(raw)) {
    throw new Error('Usa un porcentaje válido (0 a 100, hasta 2 decimales).');
  }
  const normalized = raw.replace(',', '.');
  const [wholePart, decimalPart = ''] = normalized.split('.');
  const bps = Number(wholePart) * 100 + Number(decimalPart.padEnd(2, '0'));
  if (bps < 0 || bps > 10000) {
    throw new Error('El porcentaje debe estar entre 0 y 100.');
  }
  return bps;
}

export function centsToInput(cents) {
  assertInteger(cents, 'cents');
  return (cents / 100).toFixed(2);
}

export function assertInteger(value, label = 'value') {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} debe ser un entero seguro.`);
  }
}
