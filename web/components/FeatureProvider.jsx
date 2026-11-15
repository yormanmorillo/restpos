'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { FEATURES, defaultFeatureFlags } from '@restpos/shared/features';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth/AuthProvider';
import { cacheFeatures, readCachedFeatures } from '@/lib/offline';

const FeatureContext = createContext(null);
const DEFAULTS = defaultFeatureFlags();

export function FeatureProvider({ children }) {
  const { staff } = useAuth();
  const [flags, setFlags] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!staff) {
      setFlags(DEFAULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await api.getFeatures();
      const next = { ...DEFAULTS, ...(response.features?.flags ?? {}) };
      setFlags(next);
      cacheFeatures(next);
    } catch {
      const cached = typeof navigator !== 'undefined' && !navigator.onLine ? readCachedFeatures() : null;
      setFlags(cached ? { ...DEFAULTS, ...cached } : DEFAULTS);
    } finally {
      setLoading(false);
    }
  }, [staff]);

  useEffect(() => { void load(); }, [load]);

  const enabled = useCallback((key) => Boolean(flags[key] ?? DEFAULTS[key]), [flags]);
  const value = useMemo(() => ({ flags, loading, enabled, reload: load, definitions: FEATURES }), [flags, loading, enabled, load]);
  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>;
}

export function useFeatures() {
  const context = useContext(FeatureContext);
  if (!context) {
    return { flags: DEFAULTS, loading: false, enabled: (key) => Boolean(DEFAULTS[key]), definitions: FEATURES };
  }
  return context;
}

export function FeatureGate({ feature, children, fallback = null }) {
  const { enabled } = useFeatures();
  return enabled(feature) ? children : fallback;
}
