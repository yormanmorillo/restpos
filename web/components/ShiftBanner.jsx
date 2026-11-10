'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import { api } from '@/lib/api';
import { useAuth } from './auth/AuthProvider';

export default function ShiftBanner() {
  const pathname = usePathname();
  const { staff } = useAuth();
  const [shift, setShift] = useState(undefined);

  const load = useCallback(async () => {
    if (!staff || !['admin', 'manager', 'cashier'].includes(staff.role)) return;
    try {
      const response = await api.getCurrentShift();
      setShift(response.shift);
    } catch {
      setShift(null);
    }
  }, [staff]);

  useEffect(() => {
    void load();
    window.addEventListener('restpos:shift-changed', load);
    return () => window.removeEventListener('restpos:shift-changed', load);
  }, [load]);

  if (!staff || !['admin', 'manager', 'cashier'].includes(staff.role)) return null;
  if (pathname === '/caja' || pathname === '/') return null;
  if (shift === undefined || shift) return null;

  return (
    <div className="shift-alert">
      <span className="shift-alert-icon"><Icon name="cash" size={19} /></span>
      <div>
        <strong>La caja está cerrada</strong>
        <span>Abre un turno para poder cobrar los pedidos.</span>
      </div>
      <Link href="/caja" className="btn btn-small btn-dark">Abrir caja</Link>
    </div>
  );
}
