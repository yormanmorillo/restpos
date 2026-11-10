'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Icon from '@/components/Icon';
import PaymentMethodModal from '@/components/admin/PaymentMethodModal';
import { useAuth } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api';

export default function OwnerPanelPage() {
  const { staff } = useAuth();
  const [settings, setSettings] = useState(null);
  const [methods, setMethods] = useState([]);
  const [team, setTeam] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState(false);
  const [restaurantName, setRestaurantName] = useState('');
  const [methodModal, setMethodModal] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsResponse, methodsResponse, teamResponse, integrationsResponse, healthResponse] = await Promise.all([
        api.getSettings(),
        api.getPaymentMethods(),
        api.getStaff(),
        api.getIntegrations(),
        api.getHealth(),
      ]);
      setSettings(settingsResponse.settings);
      setRestaurantName(settingsResponse.settings.restaurant_name || '');
      setMethods(methodsResponse.methods ?? []);
      setTeam(teamResponse.staff ?? []);
      setIntegrations(integrationsResponse.integrations ?? []);
      setHealth(healthResponse);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el panel.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const activeMethods = useMemo(() => methods.filter((method) => method.active), [methods]);
  const activeTeam = useMemo(() => team.filter((person) => person.active), [team]);
  const activeIntegrations = useMemo(() => integrations.filter((item) => item.active), [integrations]);

  async function saveName(event) {
    event.preventDefault();
    setSavingName(true);
    try {
      const response = await api.updateSettings({ restaurant_name: restaurantName.trim() });
      setSettings(response.settings);
      setToast({ type: 'success', message: 'Nombre del restaurante actualizado.' });
    } catch (saveError) {
      setToast({ type: 'error', message: saveError.message || 'No se pudo guardar el nombre.' });
    } finally {
      setSavingName(false);
    }
  }

  async function saveMethod(payload) {
    const response = await api.createPaymentMethod(payload);
    setMethods((previous) => [...previous, response.method]);
    setToast({ type: 'success', message: `Método “${response.method.name}” creado.` });
  }

  return (
    <div className="owner-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Administración del software</span>
          <h1>Panel del propietario</h1>
          <p>Hola, {staff?.name}. Desde aquí controlas la identidad del negocio, los pagos y las conexiones del sistema.</p>
        </div>
        <span className="owner-badge"><Icon name="crown" size={18} /> Super admin</span>
      </div>

      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p><button type="button" className="btn btn-small btn-secondary" onClick={() => void load()}>Reintentar</button></div> : null}
      {loading ? <div className="app-loading"><span className="spinner" /> Cargando panel…</div> : settings ? (
        <>
          <div className="owner-summary-grid">
            <div className="owner-summary-card"><span className="summary-card-icon"><Icon name="card" size={20} /></span><div><span>Métodos de pago</span><strong>{activeMethods.length}</strong><small>{methods.length} configurados</small></div></div>
            <div className="owner-summary-card"><span className="summary-card-icon"><Icon name="users" size={20} /></span><div><span>Equipo</span><strong>{activeTeam.length}</strong><small>{team.length} cuentas</small></div></div>
            <div className="owner-summary-card"><span className="summary-card-icon"><Icon name="plug" size={20} /></span><div><span>Integraciones</span><strong>{activeIntegrations.length}</strong><small>{integrations.length} configuradas</small></div></div>
            <div className="owner-summary-card"><span className="summary-card-icon"><Icon name="bag" size={20} /></span><div><span>Pedidos en línea</span><strong>{settings.online_ordering_enabled === 'true' ? 'Activos' : 'Inactivos'}</strong><small>Recoger y delivery</small></div></div>
          </div>

          <div className="owner-grid">
            <section className="panel owner-panel">
              <div className="panel-heading"><div><h2>Identidad del negocio</h2><p>Nombre visible en POS, tickets y menú público</p></div><Icon name="leaf" size={21} /></div>
              <form className="owner-name-form" onSubmit={saveName}>
                <label className="field"><span className="field-label">Nombre del restaurante</span><input className="input" value={restaurantName} onChange={(event) => setRestaurantName(event.target.value)} maxLength={80} /></label>
                <button type="submit" className="btn btn-primary" disabled={savingName}>{savingName ? <span className="spinner spinner-small" /> : <Icon name="save" size={18} />} Guardar</button>
              </form>
            </section>

            <section className="panel owner-panel">
              <div className="panel-heading"><div><h2>Métodos de pago</h2><p>Efectivo, tarjetas, SINPE y transferencias</p></div><button type="button" className="btn btn-small btn-primary" onClick={() => setMethodModal(true)}><Icon name="plus" size={16} /> Agregar</button></div>
              <div className="owner-method-list">
                {methods.map((method) => (
                  <div key={method.id} className="owner-method-row">
                    <span className={`method-icon method-${method.kind}`}><Icon name={method.icon} size={16} /></span>
                    <div><strong>{method.name}</strong><span>{method.allowsPhoto ? 'Acepta comprobante' : 'Sin comprobante'}</span></div>
                    <span className={`status-badge ${method.active ? 'is-active' : 'is-inactive'}`}>{method.active ? 'Activo' : 'Inactivo'}</span>
                  </div>
                ))}
              </div>
              <Link href="/admin/pagos" className="owner-link">Administrar métodos <Icon name="chevronRight" size={15} /></Link>
            </section>

            <section className="panel owner-panel">
              <div className="panel-heading"><div><h2>Accesos del sistema</h2><p>Equipo, integraciones y ajustes</p></div></div>
              <div className="owner-links">
                <Link href="/admin/equipo"><Icon name="users" size={18} /><span><strong>Equipo</strong><small>Gerentes, cajeros, meseros y cocina</small></span><Icon name="chevronRight" size={15} /></Link>
                <Link href="/owner/integraciones"><Icon name="plug" size={18} /><span><strong>Integraciones</strong><small>APIs externas para pagos, contabilidad o delivery</small></span><Icon name="chevronRight" size={15} /></Link>
                <Link href="/admin/inventario"><Icon name="box" size={18} /><span><strong>Inventario</strong><small>Stock, entradas de mercancía y recetas</small></span><Icon name="chevronRight" size={15} /></Link>
                <Link href="/admin/ajustes"><Icon name="settings" size={18} /><span><strong>Ajustes</strong><small>Pedidos en línea, caja e impresión</small></span><Icon name="chevronRight" size={15} /></Link>
              </div>
            </section>

            <section className="panel owner-panel">
              <div className="panel-heading"><div><h2>Información del sistema</h2><p>Configuración técnica activa</p></div></div>
              <div className="owner-system-grid">
                <div><span>Zona horaria</span><strong>{health?.timezone ?? '—'}</strong></div>
                <div><span>Moneda</span><strong>{health?.currency ?? '—'}</strong></div>
                <div><span>Impuesto</span><strong>{health ? `${health.taxRateBps / 100}%` : '—'}</strong></div>
                <div><span>Impresión</span><strong>{settings.printer_enabled === 'true' ? (settings.printer_connection === 'browser' ? 'Navegador' : 'Red') : 'Desactivada'}</strong></div>
              </div>
            </section>
          </div>
        </>
      ) : null}

      <PaymentMethodModal open={methodModal} method={null} onClose={() => setMethodModal(false)} onSubmit={saveMethod} />
      {toast ? <div className={`toast toast-${toast.type}`}>{toast.message}</div> : null}
    </div>
  );
}
