import net from 'node:net';
import { validationError } from './errors.js';

function isPrivateIpv4(value) {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  return false;
}

export function isAllowedPrinterHost(value) {
  const host = String(value ?? '').trim().toLowerCase();
  if (!host) return true;
  if (['localhost', 'ip6-localhost', 'metadata.google.internal'].includes(host)) return false;
  const version = net.isIP(host);
  if (version === 4) return isPrivateIpv4(host);
  if (version === 6) {
    return host.startsWith('fc') || host.startsWith('fd');
  }
  if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host)) return true;
  return host.endsWith('.local') && /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host);
}

const SETTING_VALIDATORS = {
  restaurant_name: (value) => value.trim().length > 0 && value.length <= 80,
  restaurant_tagline: (value) => value.length <= 80,
  restaurant_address: (value) => value.length <= 200,
  restaurant_phone: (value) => value.length <= 30,
  online_ordering_enabled: (value) => value === 'true' || value === 'false',
  online_pickup_enabled: (value) => value === 'true' || value === 'false',
  online_delivery_enabled: (value) => value === 'true' || value === 'false',
  delivery_fee_cents: (value) => /^\d+$/.test(value) && Number(value) <= 1_000_000,
  printer_enabled: (value) => value === 'true' || value === 'false',
  printer_connection: (value) => value === 'network' || value === 'browser',
  printer_paper_width_mm: (value) => value === '58' || value === '80',
  kitchen_printer_host: (value) => value.length <= 255 && isAllowedPrinterHost(value),
  kitchen_printer_port: (value) => /^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) < 65536,
  receipt_printer_host: (value) => value.length <= 255 && isAllowedPrinterHost(value),
  receipt_printer_port: (value) => /^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) < 65536,
  auto_print_kitchen: (value) => value === 'true' || value === 'false',
  require_shift: (value) => value === 'true' || value === 'false',
};

export function getSettings(db) {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM settings ORDER BY key').all().map((row) => [row.key, row.value]),
  );
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function getBooleanSetting(db, key, fallback = false) {
  const value = getSetting(db, key, null);
  if (value === null) return fallback;
  return value === 'true';
}

export function filterSettingsForRole(settings, role) {
  if (['owner', 'admin'].includes(role)) return settings;
  const filtered = { ...settings };
  for (const key of Object.keys(filtered)) {
    if (key.endsWith('_printer_host') || key.endsWith('_printer_port')) delete filtered[key];
  }
  return filtered;
}

export function updateSettings(db, input) {
  const entries = Object.entries(input);
  if (entries.length === 0) throw validationError('No hay configuración para guardar.');
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  for (const [key, rawValue] of entries) {
    const validator = SETTING_VALIDATORS[key];
    if (!validator) throw validationError(`Configuración desconocida: ${key}.`);
    const value = String(rawValue);
    if (!validator(value)) throw validationError(`Valor inválido para ${key}.`);
    statement.run(key, value, now);
  }
  return getSettings(db);
}

export function publicFeatures(db) {
  return {
    onlineOrdering: getBooleanSetting(db, 'online_ordering_enabled', false),
    onlinePickup: getBooleanSetting(db, 'online_pickup_enabled', true),
    onlineDelivery: getBooleanSetting(db, 'online_delivery_enabled', true),
    deliveryFeeCents: Number(getSetting(db, 'delivery_fee_cents', '0')),
    restaurantName: getSetting(db, 'restaurant_name', 'Casa Roble'),
  };
}

export function safeFeatures(db) {
  return {
    ...publicFeatures(db),
    requireShift: getBooleanSetting(db, 'require_shift', true),
    printerEnabled: getBooleanSetting(db, 'printer_enabled', false),
    printerConnection: getSetting(db, 'printer_connection', 'network'),
    printerPaperWidthMm: getSetting(db, 'printer_paper_width_mm', '80'),
    require_shift: String(getBooleanSetting(db, 'require_shift', true)),
    printer_enabled: String(getBooleanSetting(db, 'printer_enabled', false)),
    printer_connection: getSetting(db, 'printer_connection', 'network'),
    printer_paper_width_mm: getSetting(db, 'printer_paper_width_mm', '80'),
    currency: 'MXN',
  };
}
