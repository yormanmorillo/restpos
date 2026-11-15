import { api } from './api';

const QUEUE_KEY = 'restpos_offline_queue_v1';
const CATALOG_KEY = 'restpos_offline_catalog_v1';
const FEATURES_KEY = 'restpos_offline_features_v1';
const STAFF_KEY = 'restpos_offline_staff_v1';

function read(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* almacenamiento lleno */ }
}

export function cacheCatalog(catalog) { write(CATALOG_KEY, catalog); }
export function readCachedCatalog() { return read(CATALOG_KEY, null); }
export function cacheFeatures(features) { write(FEATURES_KEY, features); }
export function readCachedFeatures() { return read(FEATURES_KEY, null); }
export function cacheStaff(staff) { write(STAFF_KEY, staff); }
export function readCachedStaff() { return read(STAFF_KEY, null); }
export function clearCachedStaff() { write(STAFF_KEY, null); }

export function readQueue() { return read(QUEUE_KEY, []); }
export function writeQueue(queue) { write(QUEUE_KEY, queue); }
export function enqueueOfflineSale(sale) {
  const queue = readQueue();
  if (queue.some((entry) => entry.operationId === sale.operationId)) return queue;
  const next = [...queue, sale];
  writeQueue(next);
  return next;
}

export function queuedTotal(queue = readQueue()) {
  return queue.reduce((sum, entry) => sum + Number(entry.expectedTotalCents ?? 0), 0);
}

export async function flushOfflineQueue() {
  if (typeof window === 'undefined' || !navigator.onLine) return { synced: 0, remaining: readQueue().length };
  let synced = 0;
  const queue = readQueue();
  const remaining = [];
  for (const sale of queue) {
    try {
      await api.createOfflineSale({
        operationId: sale.operationId,
        occurredAt: sale.occurredAt,
        customerName: sale.customerName ?? '',
        items: sale.items,
        cashReceivedCents: sale.cashReceivedCents,
      });
      synced += 1;
    } catch (error) {
      remaining.push({ ...sale, lastError: error?.message || 'No se pudo sincronizar.' });
    }
  }
  writeQueue(remaining);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('restpos:offline-synced', { detail: { synced, remaining: remaining.length } }));
  return { synced, remaining: remaining.length };
}
