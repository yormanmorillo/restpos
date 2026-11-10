'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon from './Icon';

const NAV_ITEMS = [
  { href: '/', label: 'Vender', icon: 'pos' },
  { href: '/historial', label: 'Historial', icon: 'history' },
  { href: '/admin', label: 'Administración', icon: 'admin' },
];

export default function AppHeader() {
  const pathname = usePathname();
  const [now, setNow] = useState(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href="/" className="brand" aria-label="Casa Roble, ir al punto de venta">
          <span className="brand-mark">
            <Icon name="leaf" size={23} />
          </span>
          <span className="brand-copy">
            <strong>Casa Roble</strong>
            <span>Punto de venta</span>
          </span>
        </Link>

        <nav className="main-nav" aria-label="Navegación principal">
          {NAV_ITEMS.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="header-meta" suppressHydrationWarning>
          <span className="open-pill">
            <span className="pulse-dot" aria-hidden="true" />
            Caja abierta
          </span>
          <span className="header-clock">
            {now
              ? (() => {
                  const date = new Intl.DateTimeFormat('es-MX', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  }).format(now);
                  const time = new Intl.DateTimeFormat('es-MX', {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(now);
                  return `${date.charAt(0).toUpperCase()}${date.slice(1)} · ${time}`;
                })()
              : '—'}
          </span>
        </div>
      </div>
    </header>
  );
}
