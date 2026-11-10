'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/Icon';

const TABS = [
  { href: '/owner', label: 'Panel', icon: 'admin', exact: true },
  { href: '/owner/integraciones', label: 'Integraciones', icon: 'plug' },
  { href: '/admin/pagos', label: 'Métodos de pago', icon: 'card' },
  { href: '/admin/inventario', label: 'Inventario', icon: 'box' },
  { href: '/admin/equipo', label: 'Equipo', icon: 'users' },
  { href: '/admin/ajustes', label: 'Ajustes', icon: 'settings' },
];

export default function OwnerNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-subnav owner-subnav" aria-label="Panel del propietario">
      {TABS.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={`admin-subnav-link ${active ? 'is-active' : ''}`}>
            <Icon name={tab.icon} size={18} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
