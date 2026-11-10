'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';

export default function ProductModifierGroupsModal({ open, product, groups, onClose, onSubmit }) {
  const [selected, setSelected] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelected(product?.modifierGroupIds ?? []);
    setError('');
    setBusy(false);
  }, [open, product]);

  async function save() {
    setBusy(true);
    setError('');
    try {
      await onSubmit(selected);
      onClose();
    } catch (submitError) {
      setError(submitError.message || 'No se pudieron guardar las opciones.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Opciones del producto"
      subtitle={product?.name}
      size="sm"
      closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? <span className="spinner spinner-small" /> : <Icon name="check" size={18} />} Guardar</button></div></div>}
    >
      {groups.length === 0 ? (
        <p className="field-hint">Todavía no hay grupos de modificadores. Crea uno primero.</p>
      ) : (
        <div className="assign-group-list">
          {groups.map((group) => (
            <label key={group.id} className={`assign-group-row ${selected.includes(group.id) ? 'is-selected' : ''}`}>
              <input
                type="checkbox"
                checked={selected.includes(group.id)}
                onChange={(event) => setSelected((previous) => event.target.checked ? [...previous, group.id] : previous.filter((id) => id !== group.id))}
              />
              <span>
                <strong>{group.name}</strong>
                <small>{group.options.length} opciones · {group.required ? 'obligatorio' : 'opcional'}</small>
              </span>
              {selected.includes(group.id) ? <Icon name="check" size={18} /> : null}
            </label>
          ))}
        </div>
      )}
      {error ? <p className="form-error">{error}</p> : null}
    </Modal>
  );
}
