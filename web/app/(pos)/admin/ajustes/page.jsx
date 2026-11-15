'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth/AuthProvider';
import FeatureSettings from '@/components/admin/FeatureSettings';
import { centsToInput, parseMoneyToCents } from '@restpos/shared/money';

function Toggle({ checked, onChange, title, description, disabled = false }) {
  return (
    <label className={`settings-toggle ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span className="toggle-track" aria-hidden="true"><span /></span>
      <span><strong>{title}</strong><small>{description}</small></span>
    </label>
  );
}

export default function SettingsPage() {
  const { staff } = useAuth();
  const canConfigurePrinters = staff?.role === 'owner';
  const isOwner = staff?.role === 'owner';
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getSettings();
      setSettings({ ...response.settings, delivery_fee_display: centsToInput(Number(response.settings.delivery_fee_cents ?? 0)) });
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar la configuración.');
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

  function update(key, value) {
    setSettings((previous) => ({ ...previous, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      let deliveryFeeCents = 0;
      try {
        deliveryFeeCents = parseMoneyToCents(settings.delivery_fee_display);
      } catch (parseError) {
        throw new Error(`Costo de entrega: ${parseError.message}`);
      }
      const payload = {
        restaurant_name: settings.restaurant_name,
        restaurant_tagline: settings.restaurant_tagline ?? '',
        restaurant_address: settings.restaurant_address ?? '',
        restaurant_phone: settings.restaurant_phone ?? '',
        online_ordering_enabled: String(bool('online_ordering_enabled')),
        online_pickup_enabled: String(bool('online_pickup_enabled')),
        online_delivery_enabled: String(bool('online_delivery_enabled')),
        delivery_fee_cents: String(deliveryFeeCents),
        printer_enabled: String(bool('printer_enabled')),
        printer_connection: settings.printer_connection || 'network',
        printer_paper_width_mm: String(settings.printer_paper_width_mm || '80'),
        ...(canConfigurePrinters ? {
          printer_allowed_hosts: settings.printer_allowed_hosts ?? '',
          kitchen_printer_host: settings.kitchen_printer_host ?? '',
          kitchen_printer_port: String(settings.kitchen_printer_port || '9100'),
          receipt_printer_host: settings.receipt_printer_host ?? '',
          receipt_printer_port: String(settings.receipt_printer_port || '9100'),
        } : {}),
        auto_print_kitchen: String(bool('auto_print_kitchen')),
        require_shift: String(bool('require_shift')),
        server_can_charge: String(bool('server_can_charge')),
      };
      const response = await api.updateSettings(payload);
      setSettings({ ...response.settings, delivery_fee_display: centsToInput(Number(response.settings.delivery_fee_cents)) });
      setToast({ type: 'success', message: 'Configuración guardada.' });
    } catch (saveError) {
      setError(saveError.message || 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="app-loading"><span className="spinner" /> Cargando ajustes…</div>;

  if (!settings) {
    return (
      <div className="empty-panel">
        <Icon name="alert" size={30} />
        <h3>No se pudo cargar la configuración</h3>
        <p>{error}</p>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>Reintentar</button>
      </div>
    );
  }

  const bool = (key) => settings[key] === true || settings[key] === 'true';

  return (
    <div className="admin-section-page settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Configuración</span>
          <h1>Ajustes del restaurante</h1>
          <p>Controla pedidos en línea, caja e impresión térmica.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
          {saving ? <span className="spinner spinner-small" /> : <Icon name="save" size={19} />}
          Guardar cambios
        </button>
      </div>

      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p></div> : null}

      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel settings-panel">
            <div className="panel-heading"><div><h2>Identidad</h2><p>Nombre visible en el POS y en el menú en línea</p></div><Icon name="leaf" size={22} /></div>
            <label className="field">
              <span className="field-label">Nombre del restaurante</span>
              <input className="input" value={settings.restaurant_name ?? ''} onChange={(event) => update('restaurant_name', event.target.value)} maxLength={80} />
            </label>
            <label className="field">
              <span className="field-label">Frase o especialidad</span>
              <input className="input" value={settings.restaurant_tagline ?? ''} onChange={(event) => update('restaurant_tagline', event.target.value)} maxLength={80} placeholder="Ej. Cocina de la casa" />
            </label>
            <label className="field">
              <span className="field-label">Dirección para el ticket</span>
              <input className="input" value={settings.restaurant_address ?? ''} onChange={(event) => update('restaurant_address', event.target.value)} maxLength={200} placeholder="Calle, número, ciudad" />
            </label>
            <label className="field">
              <span className="field-label">Teléfono para el ticket</span>
              <input className="input" value={settings.restaurant_phone ?? ''} onChange={(event) => update('restaurant_phone', event.target.value)} maxLength={30} placeholder="+506 0000 0000" />
            </label>
          </section>

          <section className="panel settings-panel">
            <div className="panel-heading"><div><h2>Pedidos en línea</h2><p>Habilita el menú público y elige los tipos de servicio.</p></div><Icon name="bag" size={22} /></div>
            <Toggle checked={bool('online_ordering_enabled')} onChange={(value) => update('online_ordering_enabled', value)} title="Pedidos en línea" description="Muestra el menú público en /pedir." />
            <div className="settings-subgroup">
              <Toggle checked={bool('online_pickup_enabled')} onChange={(value) => update('online_pickup_enabled', value)} title="Recoger en restaurante" description="El cliente recoge su pedido." disabled={!bool('online_ordering_enabled')} />
              <Toggle checked={bool('online_delivery_enabled')} onChange={(value) => update('online_delivery_enabled', value)} title="Entrega a domicilio" description="El cliente captura su dirección." disabled={!bool('online_ordering_enabled')} />
            </div>
            <label className="field">
              <span className="field-label">Costo de entrega <small className="field-hint">opcional</small></span>
              <div className="money-input-wrap"><span className="money-prefix">₡</span><input className="input money-input" inputMode="decimal" value={settings.delivery_fee_display ?? '0.00'} onChange={(event) => update('delivery_fee_display', event.target.value)} /></div>
            </label>
          </section>

          <section className="panel settings-panel">
            <div className="panel-heading"><div><h2>Caja</h2><p>Control de turnos y efectivo</p></div><Icon name="cash" size={22} /></div>
            <Toggle checked={bool('require_shift')} onChange={(value) => update('require_shift', value)} title="Exigir turno abierto para cobrar" description="Recomendado para llevar control de caja y arqueo." />
            <Toggle checked={bool('server_can_charge')} onChange={(value) => update('server_can_charge', value)} title="Permitir que los meseros cobren" description="Si se desactiva, el mesero toma pedidos pero caja cobra." />
          </section>
        </div>

        <div className="settings-side">
          <section className="panel settings-panel">
            <div className="panel-heading"><div><h2>Impresión térmica</h2><p>Impresoras ESC/POS en red (puerto 9100)</p></div><Icon name="printer" size={22} /></div>
            <Toggle checked={bool('printer_enabled')} onChange={(value) => update('printer_enabled', value)} title="Habilitar impresión" description="Comandas y tickets en impresora térmica." />
            <div className="form-grid">
              <label className="field"><span className="field-label">Conexión</span><select className="input select" value={settings.printer_connection || 'network'} onChange={(event) => update('printer_connection', event.target.value)}><option value="network">Red TCP / ESC-POS</option><option value="browser">Navegador / impresora instalada</option></select></label>
              <label className="field"><span className="field-label">Ancho del papel</span><select className="input select" value={String(settings.printer_paper_width_mm || '80')} onChange={(event) => update('printer_paper_width_mm', event.target.value)}><option value="80">80 mm</option><option value="58">58 mm</option></select></label>
            </div>
            {settings.printer_connection === 'browser' ? (
              <div className="printer-browser-note"><Icon name="printer" size={18} /><p>Se usará el diálogo de impresión del dispositivo. Funciona con cualquier impresora térmica instalada (USB, Bluetooth o red) mediante su controlador.</p></div>
            ) : (
              <>
                <div className="printer-config">
                  <h3>Impresora de cocina</h3>
                  {canConfigurePrinters ? (
                    <div className="form-grid">
                      <label className="field"><span className="field-label">Host o IP</span><input className="input" value={settings.kitchen_printer_host ?? ''} onChange={(event) => update('kitchen_printer_host', event.target.value)} placeholder="192.168.1.50" /></label>
                      <label className="field"><span className="field-label">Puerto</span><input className="input" type="number" value={settings.kitchen_printer_port ?? '9100'} onChange={(event) => update('kitchen_printer_port', event.target.value)} /></label>
                    </div>
                  ) : <p className="field-hint"><Icon name="lock" size={14} /> Solo el super admin puede cambiar la IP o el puerto.</p>}
                  <Toggle checked={bool('auto_print_kitchen')} onChange={(value) => update('auto_print_kitchen', value)} title="Imprimir al enviar a cocina" description="Genera la comanda automáticamente." disabled={!bool('printer_enabled')} />
                </div>
                <div className="printer-config">
                  <h3>Impresora de tickets</h3>
                  {canConfigurePrinters ? (
                    <div className="form-grid">
                      <label className="field"><span className="field-label">Host o IP</span><input className="input" value={settings.receipt_printer_host ?? ''} onChange={(event) => update('receipt_printer_host', event.target.value)} placeholder="192.168.1.51" /></label>
                      <label className="field"><span className="field-label">Puerto</span><input className="input" type="number" value={settings.receipt_printer_port ?? '9100'} onChange={(event) => update('receipt_printer_port', event.target.value)} /></label>
                    </div>
                  ) : <p className="field-hint"><Icon name="lock" size={14} /> Solo el super admin puede cambiar la IP o el puerto.</p>}
                </div>
                {canConfigurePrinters ? (
                  <label className="field">
                    <span className="field-label">Hosts autorizados <small className="field-hint">separados por coma</small></span>
                    <input className="input" value={settings.printer_allowed_hosts ?? ''} onChange={(event) => update('printer_allowed_hosts', event.target.value)} placeholder="192.168.1.50, 192.168.1.51, impresora.local" />
                    <span className="field-hint">Solo estas IPs o nombres pueden recibir impresión.</span>
                  </label>
                ) : null}
                <p className="field-hint"><Icon name="note" size={14} /> La impresión se envía directamente al puerto TCP de la impresora; no usa el diálogo del navegador.</p>
              </>
            )}
          </section>
          {isOwner ? <FeatureSettings /> : null}
        </div>
      </div>

      {toast ? <div className={`toast toast-${toast.type}`}>{toast.message}</div> : null}
    </div>
  );
}
