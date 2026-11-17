'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { homeForRole, useAuth } from '@/components/auth/AuthProvider';

const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back'];
const PIN_LENGTH = 6;

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="app-loading"><span className="spinner" /></div>}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { staff, loading, refresh, setStaff } = useAuth();
  const [options, setOptions] = useState([]);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [pin, setPin] = useState('');
  const [setupMode, setSetupMode] = useState(false);
  const [setupName, setSetupName] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [setupConfirm, setSetupConfirm] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nextPath = useMemo(() => {
    const next = searchParams.get('next');
    return next && next.startsWith('/') ? next : null;
  }, [searchParams]);

  const load = useCallback(async () => {
    const status = await refresh();
    if (status.authenticated && status.staff) {
      router.replace(nextPath && status.staff.role !== 'kitchen' ? nextPath : homeForRole(status.staff.role));
      return;
    }
    setSetupMode(Boolean(status.setupRequired));
    if (!status.setupRequired) {
      try {
        const response = await api.getAuthOptions();
        setOptions(response.staff ?? []);
      } catch {
        setOptions([]);
      }
    }
  }, [refresh, router, nextPath]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading && staff) {
      router.replace(nextPath && staff.role !== 'kitchen' ? nextPath : homeForRole(staff.role));
    }
  }, [staff, loading, router, nextPath]);

  function pressKey(key) {
    setError('');
    if (key === 'clear') {
      setPin('');
      return;
    }
    if (key === 'back') {
      setPin((previous) => previous.slice(0, -1));
      return;
    }
    setPin((previous) => (previous.length >= PIN_LENGTH ? previous : previous + key));
  }

  async function submitPin() {
    if (!selectedStaff || pin.length < PIN_LENGTH) {
      setError('Selecciona tu nombre e ingresa tu PIN.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await api.login({ staffId: selectedStaff.id, pin });
      setStaff(response.staff);
      router.replace(nextPath && response.staff.role !== 'kitchen' ? nextPath : homeForRole(response.staff.role));
    } catch (loginError) {
      setError(loginError.message || 'PIN incorrecto.');
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  async function submitSetup(event) {
    event.preventDefault();
    if (!setupName.trim()) {
      setError('Escribe el nombre del propietario.');
      return;
    }
    if (!/^\d{6}$/.test(setupPin)) {
      setError('El PIN debe tener exactamente 6 dígitos.');
      return;
    }
    if (setupPin !== setupConfirm) {
      setError('Los PIN no coinciden.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await api.setupAdmin({ name: setupName.trim(), pin: setupPin, setupToken: setupToken.trim() || undefined });
      setStaff(response.staff);
      router.replace('/');
    } catch (setupError) {
      setError(setupError.message || 'No se pudo crear el propietario.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-brand">
        <div className="login-brand-glow" />
        <div className="login-brand-content">
          <span className="login-logo"><img src="/matmax-logo.jpg" alt="MATMAX IT Solutions" /></span>
          <h1>Casa Roble</h1>
          <p>Un punto de venta ágil para el servicio de hoy.</p>
          <div className="login-brand-points">
            <span><Icon name="check" size={17} /> Pedidos y cocina en un solo lugar</span>
            <span><Icon name="check" size={17} /> Pagos rápidos y arqueo de caja</span>
            <span><Icon name="check" size={17} /> Operación protegida por roles</span>
          </div>
        </div>
        <span className="login-brand-footer">Casa Roble · Punto de venta</span>
      </section>

      <section className="login-panel">
        {setupMode ? (
          <form className="login-card setup-card" onSubmit={submitSetup}>
            <span className="eyebrow">Configuración inicial</span>
            <h2>Crea tu propietario</h2>
            <p className="login-subtitle">Este PIN será tu acceso de propietario. Podrás activar funciones y agregar a tu equipo después.</p>
            <label className="field">
              <span className="field-label">Nombre</span>
              <input
                className="input login-text-input"
                value={setupName}
                onChange={(event) => setSetupName(event.target.value)}
                placeholder="Nombre del propietario"
                autoFocus
                maxLength={80}
              />
            </label>
            <label className="field">
              <span className="field-label">PIN de exactamente 6 dígitos</span>
              <input
                className="input login-text-input"
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                value={setupPin}
                onChange={(event) => setSetupPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
              />
            </label>
            <label className="field">
              <span className="field-label">Confirma el PIN</span>
              <input
                className="input login-text-input"
                type="password"
                inputMode="numeric"
                value={setupConfirm}
                onChange={(event) => setSetupConfirm(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••"
              />
            </label>
            <label className="field">
              <span className="field-label">Token de instalación <small>(si aplica)</small></span>
              <input
                className="input login-text-input"
                type="password"
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
                placeholder="Token configurado por el proveedor"
                autoComplete="off"
                maxLength={200}
              />
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button type="submit" className="btn btn-primary login-submit" disabled={busy}>
              {busy ? <span className="spinner spinner-small" aria-hidden="true" /> : <Icon name="arrowLeft" size={18} className="rotate-180" />}
              Crear propietario
            </button>
          </form>
        ) : selectedStaff ? (
          <div className="login-card pin-card">
            <button type="button" className="login-back" onClick={() => { setSelectedStaff(null); setPin(''); setError(''); }}>
              <Icon name="arrowLeft" size={18} /> Cambiar empleado
            </button>
            <div className="pin-person">
              <span className="login-staff-icon is-large"><Icon name={selectedStaff.icon || 'users'} size={30} /></span>
              <span className="eyebrow">Acceso del equipo</span>
              <h2>Hola, {selectedStaff.name.split(' ')[0]}</h2>
              <p className="login-subtitle">Ingresa tu PIN para abrir tu sesión.</p>
            </div>
            <div className="pin-dots" aria-label={`${pin.length} dígitos ingresados`}>
              {Array.from({ length: PIN_LENGTH }, (_, index) => (
                <span key={index} className={index < pin.length ? 'is-filled' : ''} />
              ))}
            </div>
            <p className="pin-hint">Ingresa tu PIN de exactamente 6 dígitos</p>
            <div className="pin-pad">
              {PIN_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`pin-key ${key === 'clear' ? 'is-clear' : ''}`}
                  onClick={() => pressKey(key)}
                  disabled={busy}
                  aria-label={key === 'clear' ? 'Borrar PIN' : key === 'back' ? 'Borrar último dígito' : key}
                >
                  {key === 'clear' ? 'Limpiar' : key === 'back' ? <Icon name="arrowLeft" size={21} /> : key}
                </button>
              ))}
            </div>
            {error ? <p className="form-error pin-error" role="alert">{error}</p> : null}
            <button type="button" className="btn btn-primary login-submit" onClick={() => void submitPin()} disabled={busy || pin.length < PIN_LENGTH}>
              {busy ? <span className="spinner spinner-small" aria-hidden="true" /> : <Icon name="check" size={19} />}
              Entrar
            </button>
          </div>
        ) : (
          <div className="login-card">
            <span className="eyebrow">Acceso del equipo</span>
            <h2>¿Quién está en turno?</h2>
            <p className="login-subtitle">Selecciona tu nombre para continuar.</p>
            {options.length === 0 ? (
              <div className="empty-panel login-empty">
                <Icon name="users" size={28} />
                <p>No hay empleados activos. Pide a un administrador que te dé acceso.</p>
              </div>
            ) : (
              <div className="staff-login-grid">
                {options.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    className="staff-login-card"
                    onClick={() => { setSelectedStaff(person); setPin(''); setError(''); }}
                  >
                    <span className="login-staff-icon"><Icon name={person.icon || 'users'} size={24} /></span>
                    <span className="staff-login-name">{person.name}</span>
                    <Icon name="chevronRight" size={18} />
                  </button>
                ))}
              </div>
            )}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
          </div>
        )}
      </section>
    </main>
  );
}
