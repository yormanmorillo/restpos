'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { api } from '@/lib/api';
import { ROLE_LABELS, useAuth } from './auth/AuthProvider';

const NAV_ITEMS = [
  { href: '/owner', label: 'Propietario', icon: 'admin', roles: ['owner'] },
  { href: '/', label: 'Vender', icon: 'pos', roles: ['owner', 'admin', 'manager', 'cashier', 'server'] },
  { href: '/cocina', label: 'Cocina', icon: 'chef', roles: ['owner', 'admin', 'manager', 'cashier', 'kitchen'] },
  { href: '/caja', label: 'Caja', icon: 'cash', roles: ['owner', 'admin', 'manager', 'cashier'] },
  { href: '/historial', label: 'Historial', icon: 'history', roles: ['owner', 'admin', 'manager', 'cashier'] },
  { href: '/admin', label: 'Administración', icon: 'admin', roles: ['owner', 'admin', 'manager'] },
];

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

export default function AppHeader() {
  const pathname = usePathname();
  const { staff, logout } = useAuth();
  const [now, setNow] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [shift, setShift] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const loadShift = useCallback(async () => {
    if (!staff || !['owner', 'admin', 'manager', 'cashier'].includes(staff.role)) return;
    try {
      const response = await api.getCurrentShift();
      setShift(response.shift);
    } catch {
      setShift(null);
    }
  }, [staff]);

  useEffect(() => {
    void loadShift();
    window.addEventListener('restpos:shift-changed', loadShift);
    return () => window.removeEventListener('restpos:shift-changed', loadShift);
  }, [loadShift]);

  useEffect(() => {
    const close = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!staff) return null;

  const items = NAV_ITEMS.filter((item) => item.roles.includes(staff.role));
  const clock = now
    ? `${new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short' }).format(now)} · ${new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(now)}`
    : '';

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href={staff.role === 'kitchen' ? '/cocina' : staff.role === 'owner' ? '/owner' : '/'} className="brand" aria-label="Casa Roble">
          <span className="brand-mark">
            <img src="/matmax-logo.jpg" alt="" className="brand-mark-logo" />
          </span>
          <span className="brand-copy">
            <strong>Casa Roble</strong>
            <span>Restaurant OS</span>
          </span>
        </Link>

        <nav className="main-nav" aria-label="Navegación principal">
          {items.map((item) => {
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

        <div className="header-tools">
          {['owner', 'admin', 'manager', 'cashier'].includes(staff.role) ? (
            <Link href="/caja" className={`shift-pill ${shift ? 'is-open' : 'is-closed'}`} title={shift ? 'Turno de caja abierto' : 'Abrir turno de caja'}>
              <span className="pulse-dot" aria-hidden="true" />
              <span>{shift ? 'Caja abierta' : 'Abrir caja'}</span>
            </Link>
          ) : null}
          <span className="header-clock">{clock}</span>

          <div className="account-menu" ref={menuRef}>
            <button
              type="button"
              className="account-button"
              onClick={() => setAccountOpen((value) => !value)}
              aria-expanded={accountOpen}
              aria-haspopup="menu"
            >
              <span className="avatar avatar-small">{initials(staff.name)}</span>
              <span className="account-copy">
                <strong>{staff.name}</strong>
                <small>{ROLE_LABELS[staff.role] ?? staff.role}</small>
              </span>
              <Icon name="chevronDown" size={16} />
            </button>
            {accountOpen ? (
              <div className="account-dropdown" role="menu">
                <div className="account-dropdown-head">
                  <strong>{staff.name}</strong>
                  <span>{ROLE_LABELS[staff.role] ?? staff.role}</span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="account-dropdown-item"
                  onClick={async () => {
                    setAccountOpen(false);
                    await logout();
                  }}
                >
                  <Icon name="logout" size={18} />
                  Cerrar sesión
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
