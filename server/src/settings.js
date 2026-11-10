import { validationError } from './errors.js';

const SETTING_VALIDATORS = {
  restaurant_name: (value) => value.trim().length > 0 && value.length <= 80,
  online_ordering_enabled: (value) => value === 'true' || value === 'false',
  online_pickup_enabled: (value) => value === 'true' || value === 'false',
  online_delivery_enabled: (value) => value === 'true' || value === 'false',
  delivery_fee_cents: (value) => /^\d+$/.test(value) && Number(value) <= 1_000_000,
  printer_enabled: (value) => value === 'true' || value === 'false',
  kitchen_printer_host: (value) => /^[a-zA-Z0-9._:-]{0,255}$/.test(value),
  kitchen_printer_port: (value) => /^\d{1,5}$/.test(value) && Number(value) > 0 && Number(value) < 65536,
  receipt_printer_host: (value) => /^[a-zA-Z0-9._:-]{0,255}$/.test(value),
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
