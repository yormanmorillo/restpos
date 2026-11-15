'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Icon from '@/components/Icon';
import { useFeatures } from '@/components/FeatureProvider';

const TABS = [
  { href: '/owner', label: 'Panel', icon: 'admin', exact: true },
  { href: '/owner/integraciones', label: 'Integraciones', icon: 'plug', feature: 'integrations' },
  { href: '/admin/pagos', label: 'Métodos de pago', icon: 'card' },
  { href: '/admin/inventario', label: 'Inventario', icon: 'box', feature: 'inventory' },
  { href: '/admin/equipo', label: 'Equipo', icon: 'users' },
  { href: '/admin/ajustes', label: 'Ajustes', icon: 'settings' },
];

export default function OwnerNav() {
  const pathname = usePathname();
  const { enabled } = useFeatures();
  const tabs = TABS.filter((tab) => !tab.feature || enabled(tab.feature));
  return (
    <nav className="admin-subnav owner-subnav" aria-label="Panel del propietario">
      {tabs.map((tab) => {
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
