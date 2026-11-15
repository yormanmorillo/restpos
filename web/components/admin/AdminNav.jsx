'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/Icon';
import { useAuth } from '@/components/auth/AuthProvider';
import { useFeatures } from '@/components/FeatureProvider';

const TABS = [
  { href: '/admin', label: 'Menú', icon: 'tag', exact: true },
  { href: '/admin/salon', label: 'Salón', icon: 'table' },
  { href: '/admin/modificadores', label: 'Modificadores', icon: 'sliders' },
  { href: '/admin/cocina', label: 'Estaciones', icon: 'chef', feature: 'kitchen_stations' },
  { href: '/admin/inventario', label: 'Inventario', icon: 'box', feature: 'inventory' },
  { href: '/admin/pagos', label: 'Pagos', icon: 'card' },
  { href: '/admin/equipo', label: 'Equipo', icon: 'users', adminOnly: true },
  { href: '/admin/ajustes', label: 'Ajustes', icon: 'settings' },
];

export default function AdminNav() {
  const pathname = usePathname();
  const { staff } = useAuth();
  const { enabled } = useFeatures();
  const tabs = TABS.filter((tab) => (!tab.adminOnly || ['owner', 'admin'].includes(staff?.role)) && (!tab.feature || enabled(tab.feature)));
  return (
    <nav className="admin-subnav" aria-label="Secciones de administración">
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={`admin-subnav-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
            <Icon name={tab.icon} size={18} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
