import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DEFAULT_TAX_RATE_BPS } from '@restpos/shared/pricing';

const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const defaultDatabasePath = path.join(serverRoot, 'data', 'restpos.db');

function readInteger(name, fallback, { min, max }) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} debe ser un entero entre ${min} y ${max}.`);
  }
  return value;
}

function readTimezone() {
  const value = process.env.APP_TIMEZONE || 'America/Mexico_City';
  try {
    new Intl.DateTimeFormat('es-MX', { timeZone: value }).format(new Date());
  } catch {
    throw new Error(`APP_TIMEZONE no es una zona horaria válida: ${value}`);
  }
  return value;
}

export function loadConfig(overrides = {}) {
  return {
    port: readInteger('PORT', 4000, { min: 1, max: 65535 }),
    databasePath: process.env.DATABASE_PATH || defaultDatabasePath,
    timezone: readTimezone(),
    currency: 'MXN',
    taxRateBps: readInteger('TAX_RATE_BPS', DEFAULT_TAX_RATE_BPS, { min: 0, max: 10000 }),
    sessionTtlHours: readInteger('SESSION_TTL_HOURS', 12, { min: 1, max: 168 }),
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    ...overrides,
  };
}

export const config = loadConfig();
