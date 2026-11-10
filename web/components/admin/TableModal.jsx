'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';

export default function TableModal({ open, table, areas, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('4');
  const [areaId, setAreaId] = useState('');
  const [position, setPosition] = useState('0');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(table?.name ?? '');
    setCapacity(String(table?.capacity ?? 4));
    setAreaId(String(table?.areaId ?? areas[0]?.id ?? ''));
    setPosition(String(table?.position ?? 0));
    setActive(table?.active ?? true);
    setError('');
    setBusy(false);
  }, [open, table, areas]);

  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1 || cap > 50) { setError('La capacidad debe estar entre 1 y 50.'); return; }
    setBusy(true);
    setError('');
    try {
      await onSubmit({ name: name.trim(), capacity: cap, areaId: areaId ? Number(areaId) : null, position: Number(position) || 0, active });
      onClose();
    } catch (submitError) {
      setError(submitError.message || 'No se pudo guardar la mesa.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={table ? 'Editar mesa' : 'Nueva mesa'}
      subtitle="Configura nombre, capacidad y ubicación."
      size="sm"
      closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="table-form" className="btn btn-primary" disabled={busy}>{table ? 'Guardar' : 'Crear mesa'}</button></div></div>}
    >
      <form id="table-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full"><span className="field-label">Nombre</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} autoFocus /></label>
        <label className="field"><span className="field-label">Capacidad</span><input className="input" type="number" min={1} max={50} value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label>
        <label className="field"><span className="field-label">Posición</span><input className="input" type="number" min={0} value={position} onChange={(event) => setPosition(event.target.value)} /></label>
        <label className="field field-full"><span className="field-label">Área</span><select className="input select" value={areaId} onChange={(event) => setAreaId(event.target.value)}>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>
        <label className="toggle-row field field-full"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span><span><strong>Mesa activa</strong><small>Las mesas inactivas no aparecen en el POS.</small></span></label>
        {error ? <p className="form-error field-full">{error}</p> : null}
      </form>
    </Modal>
  );
}
