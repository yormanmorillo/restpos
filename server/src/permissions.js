import { AppError } from './errors.js';
import { getBooleanSetting } from './settings.js';

export function assertCanCharge(db, staff) {
  if (staff?.role === 'server' && !getBooleanSetting(db, 'server_can_charge', true)) {
    throw new AppError(403, 'FORBIDDEN', 'Los meseros no pueden cobrar. Pide a caja que cobre este pedido.');
  }
}
