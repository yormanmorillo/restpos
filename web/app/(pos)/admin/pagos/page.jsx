'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import PaymentMethodModal from '@/components/admin/PaymentMethodModal';
import { api } from '@/lib/api';
import { useAuth } from '@/components/auth/AuthProvider';

const KIND_LABELS = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', other: 'Otro' };

export default function PaymentMethodsPage() {
  const { staff } = useAuth();
  const isOwner = staff?.role === 'owner';
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState({ open: false, method: null });
  const [busyId, setBusyId] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getPaymentMethods();
      setMethods(response.methods ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudieron cargar los métodos de pago.');
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

  async function saveMethod(payload) {
    if (modal.method) {
      const response = await api.updatePaymentMethod(modal.method.id, payload);
      setMethods((previous) => previous.map((method) => method.id === response.method.id ? response.method : method));
      setToast({ type: 'success', message: `Método “${response.method.name}” actualizado.` });
    } else {
      const response = await api.createPaymentMethod(payload);
      setMethods((previous) => [...previous, response.method]);
      setToast({ type: 'success', message: `Método “${response.method.name}” creado.` });
    }
    await load();
  }

  async function toggleMethod(method) {
    setBusyId(method.id);
    try {
      const response = await api.updatePaymentMethod(method.id, { active: !method.active });
      setMethods((previous) => previous.map((item) => item.id === response.method.id ? response.method : item));
      setToast({ type: 'success', message: response.method.active ? `“${response.method.name}” activado.` : `“${response.method.name}” desactivado.` });
    } catch (toggleError) {
      setToast({ type: 'error', message: toggleError.message || 'No se pudo cambiar el método.' });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Caja</span>
          <h1>Métodos de pago</h1>
          <p>Activa o desactiva los métodos existentes. Solo el super admin puede crear nuevos métodos o cambiar su configuración.</p>
        </div>
        {isOwner ? (
          <button type="button" className="btn btn-primary" onClick={() => setModal({ open: true, method: null })}>
            <Icon name="plus" size={19} /> Nuevo método
          </button>
        ) : null}
      </div>

      <div className="payment-methods-intro">
        <span className="payment-methods-intro-icon"><Icon name="phone" size={21} /></span>
        <div>
          <strong>Pensado para Costa Rica</strong>
          <p>Efectivo en colones o dólares, tarjetas de débito/crédito, SINPE Móvil y transferencias bancarias. Los métodos con foto guardan el comprobante en la auditoría del pago.</p>
        </div>
      </div>

      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p><button type="button" className="btn btn-small btn-secondary" onClick={() => void load()}>Reintentar</button></div> : null}

      {loading ? <div className="app-loading"><span className="spinner" /> Cargando métodos…</div> : (
        <div className="payment-method-admin-grid">
          {methods.map((method) => (
            <article key={method.id} className={`payment-method-admin-card ${method.active ? '' : 'is-inactive'}`}>
              <div className="payment-method-admin-top">
                <span className={`method-icon method-${method.kind}`}><Icon name={method.icon} size={21} /></span>
                <span className={`status-badge ${method.active ? 'is-active' : 'is-inactive'}`}>{method.active ? 'Activo' : 'Inactivo'}</span>
              </div>
              <h3>{method.name}</h3>
              <p>{KIND_LABELS[method.kind]}{method.allowsPhoto ? ' · acepta comprobante' : ''}</p>
              <div className="payment-method-admin-meta">
                <span><strong>{method.usageCount}</strong> pagos</span>
                <span className="method-code">{method.code}</span>
              </div>
              <div className="payment-method-admin-actions">
                {isOwner ? <button type="button" className="btn btn-small btn-secondary" onClick={() => setModal({ open: true, method })}><Icon name="edit" size={16} /> Editar</button> : null}
                <button type="button" className={`btn btn-small ${method.active ? 'btn-danger-quiet' : 'btn-success-quiet'}`} onClick={() => void toggleMethod(method)} disabled={busyId === method.id}>
                  {busyId === method.id ? <span className="spinner spinner-small" /> : null}
                  {method.active ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="admin-footnote-panel">
        <Icon name="note" size={16} />
        <p>Los métodos no se eliminan: se desactivan para conservar el historial. Si un pago antiguo usó un método inactivo, su nombre se mantiene en el ticket y en los reportes.</p>
      </div>

      {isOwner ? <PaymentMethodModal open={modal.open} method={modal.method} onClose={() => setModal({ open: false, method: null })} onSubmit={saveMethod} /> : null}
      {toast ? <div className={`toast toast-${toast.type}`}>{toast.message}</div> : null}
    </div>
  );
}
