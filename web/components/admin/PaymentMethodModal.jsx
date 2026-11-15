'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';

const KINDS = [
  ['cash', 'Efectivo'],
  ['card', 'Tarjeta débito/crédito'],
  ['transfer', 'Transferencia / SINPE'],
  ['other', 'Otro'],
];

const ICONS = [
  ['cash', 'Efectivo'],
  ['card', 'Tarjeta'],
  ['phone', 'SINPE / teléfono'],
  ['wallet', 'Transferencia'],
  ['receipt', 'Otro'],
];

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export default function PaymentMethodModal({ open, method, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [kind, setKind] = useState('other');
  const [icon, setIcon] = useState('wallet');
  const [allowsPhoto, setAllowsPhoto] = useState(false);
  const [active, setActive] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(method?.name ?? '');
    setCode(method?.code ?? '');
    setKind(method?.kind ?? 'other');
    setIcon(method?.icon ?? 'wallet');
    setAllowsPhoto(method?.allowsPhoto ?? false);
    setActive(method?.active ?? true);
    setSortOrder(String(method?.sortOrder ?? 0));
    setError('');
    setBusy(false);
  }, [open, method]);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    const finalCode = slugify(code || name);
    if (!/^[a-z0-9_]{2,40}$/.test(finalCode)) { setError('El código debe tener entre 2 y 40 caracteres.'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        ...(method ? {} : { code: finalCode }),
        name: name.trim(),
        kind,
        icon,
        allowsPhoto,
        active,
        sortOrder: Number(sortOrder) || 0,
      });
      onClose();
    } catch (submitError) {
      setError(submitError.message || 'No se pudo guardar el método.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={method ? 'Editar método de pago' : 'Nuevo método de pago'}
      subtitle="Configura cómo se registra el cobro en caja."
      size="sm"
      closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="payment-method-form" className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner spinner-small" /> : null}{method ? 'Guardar' : 'Crear método'}</button></div></div>}
    >
      <form id="payment-method-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full">
          <span className="field-label">Nombre visible</span>
          <input className="input" value={name} onChange={(event) => { setName(event.target.value); if (!method && !code) setCode(''); }} placeholder="Ej. SINPE Móvil" maxLength={60} autoFocus />
        </label>
        <label className="field field-full">
          <span className="field-label">Código interno {method ? <small className="field-hint">no se puede cambiar</small> : <small className="field-hint">se genera del nombre</small>}</span>
          <input className="input" value={method ? code : (code || slugify(name))} onChange={(event) => setCode(event.target.value)} disabled={Boolean(method)} placeholder="sinpe_movil" maxLength={40} />
        </label>
        <label className="field">
          <span className="field-label">Tipo</span>
          <select className="input select" value={kind} onChange={(event) => setKind(event.target.value)}>
            {KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Icono</span>
          <select className="input select" value={icon} onChange={(event) => setIcon(event.target.value)}>
            {ICONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Orden</span>
          <input className="input" type="number" min={0} max={9999} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
        </label>
        <label className="toggle-row field">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          <span><strong>Activo</strong><small>Disponible al cobrar.</small></span>
        </label>
        <div className="field field-full payment-method-switches">
          <label className="toggle-row">
            <input type="checkbox" checked={allowsPhoto} onChange={(event) => setAllowsPhoto(event.target.checked)} />
            <span className="toggle-track" aria-hidden="true"><span /></span>
            <span><strong>Permitir foto del comprobante</strong><small>Ideal para SINPE Móvil y transferencias bancarias.</small></span>
          </label>
        </div>
        {error ? <p className="form-error field-full" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
