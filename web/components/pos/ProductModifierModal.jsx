'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { formatMoney } from '@/lib/format';

export default function ProductModifierModal({ open, product, onClose, onAdd }) {
  const groups = product?.modifierGroups ?? [];
  const [selected, setSelected] = useState({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelected({});
    setNotes('');
    setError('');
  }, [open, product?.id]);

  const selectedModifiers = useMemo(() => {
    if (!product) return [];
    const result = [];
    for (const group of groups) {
      const ids = selected[group.id] ?? [];
      for (const id of ids) {
        const option = group.options.find((entry) => entry.id === id);
        if (option) {
          result.push({
            modifierId: option.id,
            groupName: group.name,
            modifierName: option.name,
            priceDeltaCents: option.priceDeltaCents,
          });
        }
      }
    }
    return result;
  }, [groups, selected, product]);

  const totalCents = (product?.priceCents ?? 0) + selectedModifiers.reduce((sum, modifier) => sum + modifier.priceDeltaCents, 0);

  function toggle(group, optionId) {
    setError('');
    setSelected((previous) => {
      const current = previous[group.id] ?? [];
      if (group.selectionType === 'single') {
        return { ...previous, [group.id]: current.includes(optionId) ? [] : [optionId] };
      }
      if (current.includes(optionId)) {
        return { ...previous, [group.id]: current.filter((id) => id !== optionId) };
      }
      if (current.length >= group.maxSelect) {
        setError(`"${group.name}" permite hasta ${group.maxSelect} opciones.`);
        return previous;
      }
      return { ...previous, [group.id]: [...current, optionId] };
    });
  }

  function submit() {
    for (const group of groups) {
      const count = (selected[group.id] ?? []).length;
      if (count < group.minSelect) {
        setError(`Selecciona al menos ${group.minSelect} opción${group.minSelect === 1 ? '' : 'es'} en "${group.name}".`);
        return;
      }
      if (count > group.maxSelect) {
        setError(`"${group.name}" permite hasta ${group.maxSelect} opciones.`);
        return;
      }
    }
    onAdd(product, notes.trim(), selectedModifiers);
    onClose();
  }

  if (!product) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product.name}
      subtitle={`${formatMoney(product.priceCents)} · Personaliza el platillo`}
      size="md"
      footer={
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            <Icon name="plus" size={19} /> Agregar · {formatMoney(totalCents)}
          </button>
        </div>
      }
    >
      <div className="modifier-modal-body">
        {groups.map((group) => {
          const current = selected[group.id] ?? [];
          return (
            <section key={group.id} className="modifier-group">
              <div className="modifier-group-head">
                <div>
                  <h3>{group.name}</h3>
                  <p>
                    {group.required ? 'Obligatorio' : 'Opcional'} ·{' '}
                    {group.selectionType === 'single'
                      ? 'elige 1'
                      : `elige de ${group.minSelect} a ${group.maxSelect}`}
                  </p>
                </div>
                {group.required ? <span className="required-chip">Requerido</span> : null}
              </div>
              <div className="modifier-options">
                {group.options.map((option) => {
                  const active = current.includes(option.id);
                  return (
                    <button
                      type="button"
                      key={option.id}
                      className={`modifier-option ${active ? 'is-selected' : ''}`}
                      onClick={() => toggle(group, option.id)}
                      aria-pressed={active}
                    >
                      <span className={`modifier-check ${group.selectionType === 'single' ? 'is-radio' : ''}`}>
                        {active ? <Icon name="check" size={13} /> : null}
                      </span>
                      <span>{option.name}</span>
                      {option.priceDeltaCents > 0 ? <strong>+{formatMoney(option.priceDeltaCents)}</strong> : <em>Incluido</em>}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        <label className="field">
          <span className="field-label">Nota para cocina <small className="field-hint">opcional</small></span>
          <input
            className="input"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ej. sin cebolla, extra crujiente…"
            maxLength={200}
          />
        </label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </Modal>
  );
}
