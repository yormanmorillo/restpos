'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Icon from '@/components/Icon';
import { useAuth } from '@/components/auth/AuthProvider';
import { useFeatures } from '@/components/FeatureProvider';
import { api } from '@/lib/api';
import { cacheCatalog, flushOfflineQueue, readQueue } from '@/lib/offline';

export default function OfflineManager() {
  const { staff } = useAuth();
  const { enabled } = useFeatures();
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);

  const sync = useCallback(async () => {
    if (!staff || !enabled('offline_mode') || typeof navigator === 'undefined' || !navigator.onLine) return;
    try {
      await flushOfflineQueue();
      setQueued(readQueue().length);
    } catch {
      setQueued(readQueue().length);
    }
  }, [staff, enabled]);

  useEffect(() => {
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    const onOnline = () => { setOnline(true); void sync(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('restpos:offline-synced', () => setQueued(readQueue().length));
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [sync]);

  useEffect(() => {
    if (!staff || !enabled('offline_mode')) return undefined;
    setQueued(readQueue().length);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    if (navigator.onLine) {
      api.getCatalog().then((catalog) => cacheCatalog(catalog)).catch(() => {});
      void sync();
    }
    return undefined;
  }, [staff, enabled, sync]);

  if (enabled('offline_mode') && (!online || queued > 0)) {
    return (
      <div className={`offline-bar ${online ? 'is-online' : ''}`} role="status">
        <Icon name={online ? 'refresh' : 'alert'} size={17} />
        <span>{online ? `${queued} venta(s) offline pendientes de sincronizar.` : 'Sin conexión. Puedes registrar ventas en efectivo.'}</span>
        {online ? (
          <button type="button" className="btn btn-small btn-secondary" onClick={() => void sync()}>Sincronizar</button>
        ) : (
          <Link href="/offline" className="btn btn-small btn-secondary">Abrir modo offline</Link>
        )}
      </div>
    );
  }
  return null;
}
