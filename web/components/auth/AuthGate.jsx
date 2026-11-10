'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { homeForRole, useAuth } from './AuthProvider';

const ROLE_RULES = [
  { prefix: '/owner', roles: ['owner'] },
  { prefix: '/admin', roles: ['owner', 'admin', 'manager'] },
  { prefix: '/caja', roles: ['owner', 'admin', 'manager', 'cashier'] },
  { prefix: '/historial', roles: ['owner', 'admin', 'manager', 'cashier'] },
  { prefix: '/cocina', roles: ['owner', 'admin', 'manager', 'cashier', 'kitchen'] },
];

export default function AuthGate({ children }) {
  const { staff, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !staff) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
    }
    if (!loading && staff) {
      const rule = ROLE_RULES.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
      if (rule && !rule.roles.includes(staff.role)) {
        router.replace(homeForRole(staff.role));
      } else if (pathname === '/' && staff.role === 'kitchen') {
        router.replace('/cocina');
      }
    }
  }, [loading, staff, router, pathname]);

  const rule = ROLE_RULES.find((entry) => pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`));
  const forbidden = Boolean(staff && rule && !rule.roles.includes(staff.role));
  if (loading || !staff || (staff.role === 'kitchen' && pathname === '/') || forbidden) {
    return (
      <div className="app-loading">
        <span className="spinner" aria-hidden="true" />
        <p>Cargando turno…</p>
      </div>
    );
  }

  return children;
}
