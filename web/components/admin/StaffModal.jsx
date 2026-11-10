'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';

const ROLES = [
  ['admin', 'Gerente general'],
  ['manager', 'Gerente'],
  ['cashier', 'Cajero'],
  ['server', 'Mesero'],
  ['kitchen', 'Cocina'],
  ['owner', 'Super admin (MATMAX)'],
];

export default function StaffModal({ open, person, onClose, onSubmit, allowOwner = false }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('server');
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(person?.name ?? '');
    setRole(person?.role ?? 'server');
    setPin('');
    setActive(person?.active ?? true);
    setError('');
    setBusy(false);
  }, [open, person]);

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    if (!person && !/^\d{4,8}$/.test(pin)) { setError('El PIN debe tener entre 4 y 8 dígitos.'); return; }
    if (pin && !/^\d{4,8}$/.test(pin)) { setError('El PIN debe tener entre 4 y 8 dígitos.'); return; }
    setBusy(true);
    try {
      const payload = { name: name.trim(), role, active, ...(pin ? { pin } : {}) };
      await onSubmit(payload);
      onClose();
    } catch (submitError) {
      setError(submitError.message || 'No se pudo guardar el empleado.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={person ? 'Editar empleado' : 'Nuevo empleado'}
      subtitle={person ? person.name : 'Crea un acceso para tu equipo.'}
      size="sm"
      closeDisabled={busy}
      footer={
        <div className="modal-actions">
          <span />
          <div className="modal-actions-right">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" form="staff-form" className="btn btn-primary" disabled={busy}>
              {busy ? <span className="spinner spinner-small" /> : null}
              {person ? 'Guardar cambios' : 'Crear empleado'}
            </button>
          </div>
        </div>
      }
    >
      <form id="staff-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full">
          <span className="field-label">Nombre completo</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Rol</span>
          <select className="input select" value={role} onChange={(event) => setRole(event.target.value)}>
            {ROLES.filter(([value]) => value !== 'owner' || allowOwner || person?.role === 'owner').map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{person ? 'Nuevo PIN' : 'PIN'} {person ? <small className="field-hint">opcional</small> : null}</span>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
            placeholder={person ? 'Dejar en blanco para conservar' : '4 a 8 dígitos'}
          />
        </label>
        <label className="toggle-row field field-full">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          <span><strong>Acceso activo</strong><small>Los empleados inactivos no pueden iniciar sesión.</small></span>
        </label>
        {error ? <p className="form-error field-full" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
