'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

const AuthContext = createContext(null);

export const ROLE_LABELS = {
  owner: 'Super admin',
  admin: 'Gerente general',
  manager: 'Gerente',
  cashier: 'Cajero',
  server: 'Mesero',
  kitchen: 'Cocina',
};

export function homeForRole(role) {
  if (role === 'owner') return '/owner';
  return role === 'kitchen' ? '/cocina' : '/';
}

export function AuthProvider({ children }) {
  const [staff, setStaff] = useState(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const response = await api.getAuthStatus();
      setStaff(response.staff ?? null);
      setSetupRequired(Boolean(response.setupRequired));
      return response;
    } catch {
      setStaff(null);
      return { authenticated: false, staff: null, setupRequired: false };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => {
      setStaff(null);
      router.replace('/login');
    };
    window.addEventListener('restpos:unauthorized', onUnauthorized);
    return () => window.removeEventListener('restpos:unauthorized', onUnauthorized);
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setStaff(null);
      router.replace('/login');
    }
  }, [router]);

  const value = useMemo(
    () => ({
      staff,
      loading,
      setupRequired,
      refresh,
      logout,
      setStaff,
      isRole: (...roles) => Boolean(staff && roles.includes(staff.role)),
    }),
    [staff, loading, setupRequired, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return context;
}
