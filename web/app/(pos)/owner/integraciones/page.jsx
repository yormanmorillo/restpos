'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import IntegrationModal from '@/components/owner/IntegrationModal';
import { api } from '@/lib/api';
import { FeatureGate } from '@/components/FeatureProvider';

const CATEGORY_LABELS = { payment: 'Pagos', accounting: 'Contabilidad', delivery: 'Delivery', loyalty: 'Lealtad', other: 'Otra' };

function IntegrationsPageContent() {
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState({ open: false, integration: null });
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getIntegrations();
      setIntegrations(response.integrations ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudieron cargar las integraciones.');
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

  async function save(payload) {
    if (modal.integration) {
      const response = await api.updateIntegration(modal.integration.id, payload);
      setIntegrations((previous) => previous.map((item) => item.id === response.integration.id ? response.integration : item));
      setToast({ type: 'success', message: 'Integración actualizada.' });
    } else {
      const response = await api.createIntegration(payload);
      setIntegrations((previous) => [...previous, response.integration]);
      setToast({ type: 'success', message: 'Integración creada.' });
    }
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Propietario · APIs</span>
          <h1>Integraciones externas</h1>
          <p>Prepara la conexión con pagos, facturación electrónica, contabilidad o delivery. Los conectores se activarán cuando se implementen.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setModal({ open: true, integration: null })}><Icon name="plus" size={19} /> Nueva integración</button>
      </div>

      <div className="payment-methods-intro"><span className="payment-methods-intro-icon"><Icon name="plug" size={21} /></span><div><strong>Conexiones preparadas para el futuro</strong><p>Guarda la URL y la autenticación de cada proveedor. No se envían datos todavía: el sistema queda listo para agregar el conector correspondiente.</p></div></div>
      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p><button type="button" className="btn btn-small btn-secondary" onClick={() => void load()}>Reintentar</button></div> : null}
      {loading ? <div className="app-loading"><span className="spinner" /> Cargando integraciones…</div> : integrations.length === 0 ? (
        <div className="empty-panel"><Icon name="plug" size={30} /><h3>Sin integraciones todavía</h3><p>Crea una para dejar lista la conexión con un proveedor externo.</p><button type="button" className="btn btn-primary" onClick={() => setModal({ open: true, integration: null })}>Nueva integración</button></div>
      ) : (
        <div className="integration-grid">
          {integrations.map((integration) => (
            <article key={integration.id} className={`integration-card ${integration.active ? '' : 'is-inactive'}`}>
              <div className="integration-card-top"><span className={`method-icon method-${integration.category === 'payment' ? 'card' : 'transfer'}`}><Icon name="plug" size={20} /></span><span className={`status-badge ${integration.active ? 'is-active' : 'is-inactive'}`}>{integration.active ? 'Activa' : 'Inactiva'}</span></div>
              <h3>{integration.name}</h3>
              <p>{CATEGORY_LABELS[integration.category] ?? integration.category} · {integration.authType === 'none' ? 'Sin autenticación' : integration.authType === 'bearer' ? 'Bearer token' : 'API key'}</p>
              <code>{integration.baseUrl || 'Sin URL configurada'}</code>
              {integration.notes ? <p className="field-hint">{integration.notes}</p> : null}
              <button type="button" className="btn btn-small btn-secondary" onClick={() => setModal({ open: true, integration })}><Icon name="edit" size={16} /> Editar</button>
            </article>
          ))}
        </div>
      )}

      <IntegrationModal open={modal.open} integration={modal.integration} onClose={() => setModal({ open: false, integration: null })} onSubmit={save} />
      {toast ? <div className={`toast toast-${toast.type}`}>{toast.message}</div> : null}
    </div>
  );
}

export default function IntegrationsPage() {
  return <FeatureGate feature="integrations"><IntegrationsPageContent /></FeatureGate>;
}
