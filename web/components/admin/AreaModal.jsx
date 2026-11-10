'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';

export default function AreaModal({ open, area, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(area?.name ?? '');
    setSortOrder(String(area?.sortOrder ?? 0));
    setActive(area?.active ?? true);
    setError('');
    setBusy(false);
  }, [open, area]);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), sortOrder: Number(sortOrder), active });
      onClose();
    } catch (submitError) {
      setError(submitError.message || 'No se pudo guardar el área.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={area ? 'Editar área' : 'Nueva área'}
      subtitle="Zonas del salón: terraza, barra, piso principal…"
      size="sm"
      closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="area-form" className="btn btn-primary" disabled={busy}>{area ? 'Guardar' : 'Crear área'}</button></div></div>}
    >
      <form id="area-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full"><span className="field-label">Nombre del área</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoFocus /></label>
        <label className="field"><span className="field-label">Orden</span><input className="input" type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></label>
        <label className="toggle-row field"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span><span><strong>Activa</strong></span></label>
        {error ? <p className="form-error field-full">{error}</p> : null}
      </form>
    </Modal>
  );
}
