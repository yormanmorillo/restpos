'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';

const CATEGORIES = [
  ['payment', 'Pagos'],
  ['accounting', 'Contabilidad / facturación'],
  ['delivery', 'Delivery'],
  ['loyalty', 'Lealtad / clientes'],
  ['other', 'Otra'],
];

export default function IntegrationModal({ open, integration, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [baseUrl, setBaseUrl] = useState('');
  const [authType, setAuthType] = useState('none');
  const [apiKey, setApiKey] = useState('');
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(integration?.name ?? '');
    setCategory(integration?.category ?? 'other');
    setBaseUrl(integration?.baseUrl ?? '');
    setAuthType(integration?.authType ?? 'none');
    setApiKey('');
    setActive(integration?.active ?? true);
    setNotes(integration?.notes ?? '');
    setError('');
    setBusy(false);
  }, [open, integration]);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    if (baseUrl.trim() && !/^https?:\/\//i.test(baseUrl.trim())) { setError('La URL debe iniciar con http:// o https://.'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        category,
        baseUrl: baseUrl.trim(),
        authType,
        ...(apiKey ? { apiKey } : {}),
        active,
        notes: notes.trim(),
      });
      onClose();
    } catch (submitError) {
      setError(submitError.message || 'No se pudo guardar la integración.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={integration ? 'Editar integración' : 'Nueva integración'}
      subtitle="Deja preparada la conexión con una API externa."
      size="sm"
      closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="integration-form" className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner spinner-small" /> : null}{integration ? 'Guardar' : 'Crear integración'}</button></div></div>}
    >
      <form id="integration-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full"><span className="field-label">Nombre</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ej. Facturación electrónica" autoFocus /></label>
        <label className="field"><span className="field-label">Categoría</span><select className="input select" value={category} onChange={(event) => setCategory(event.target.value)}>{CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Autenticación</span><select className="input select" value={authType} onChange={(event) => setAuthType(event.target.value)}><option value="none">Sin autenticación</option><option value="bearer">Bearer token</option><option value="api_key">API key</option></select></label>
        <label className="field field-full"><span className="field-label">URL base</span><input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.proveedor.com/v1" maxLength={500} /></label>
        {authType !== 'none' ? <label className="field field-full"><span className="field-label">Token / API key {integration?.hasApiKey ? <small className="field-hint">dejar vacío para conservar</small> : null}</span><input className="input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={integration?.apiKeyMasked || 'Token secreto'} maxLength={1000} /></label> : null}
        <label className="field field-full"><span className="field-label">Notas</span><textarea className="input textarea" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} placeholder="Qué enviaremos o recibiremos de esta API" /></label>
        <label className="toggle-row field field-full"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span><span><strong>Integración activa</strong><small>Queda lista para conectores futuros.</small></span></label>
        {error ? <p className="form-error field-full" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
