import { FEATURES, FEATURE_KEYS, defaultFeatureFlags, featureSettingKey } from '@restpos/shared/features';
import { AppError, notFound, validationError } from './errors.js';
import { getSetting } from './settings.js';

export function featureFlags(db) {
  const defaults = defaultFeatureFlags();
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => {
      const stored = getSetting(db, featureSettingKey(key), null);
      return [key, stored === null ? defaults[key] : stored === 'true'];
    }),
  );
}

export function featureEnabled(db, key) {
  if (!FEATURES[key]) throw new Error(`Función desconocida: ${key}`);
  const stored = getSetting(db, featureSettingKey(key), null);
  return stored === null ? Boolean(FEATURES[key].defaultEnabled) : stored === 'true';
}

export function requireFeature(db, key) {
  return (req, res, next) => {
    if (!featureEnabled(db, key)) {
      return next(notFound('Esta función no está activa en este restaurante.'));
    }
    return next();
  };
}

export function parseFeatureSettingKey(settingKey) {
  if (!settingKey.startsWith('feature_')) return null;
  const key = settingKey.slice('feature_'.length);
  return FEATURES[key] ? key : null;
}

export function validateFeatureSetting(settingKey, value) {
  const key = parseFeatureSettingKey(settingKey);
  if (!key) throw validationError(`Función desconocida: ${settingKey}.`);
  if (value !== 'true' && value !== 'false') {
    throw validationError(`La función ${FEATURES[key].label} debe ser true o false.`);
  }
  return true;
}

export function assertCanChangeFeatures(role) {
  if (role !== 'owner') {
    throw new AppError(403, 'FORBIDDEN', 'Solo el super admin puede activar o desactivar funciones.');
  }
}
