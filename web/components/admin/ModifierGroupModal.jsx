'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { centsToInput, parseMoneyToCents } from '@restpos/shared/money';

function emptyOption() {
  return { name: '', price: '0.00', active: true };
}

export default function ModifierGroupModal({ open, group, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [selectionType, setSelectionType] = useState('multiple');
  const [required, setRequired] = useState(false);
  const [minSelect, setMinSelect] = useState(0);
  const [maxSelect, setMaxSelect] = useState(4);
  const [sortOrder, setSortOrder] = useState(0);
  const [active, setActive] = useState(true);
  const [options, setOptions] = useState([emptyOption()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setSelectionType(group?.selectionType ?? 'multiple');
    setRequired(group?.required ?? false);
    setMinSelect(group?.minSelect ?? 0);
    setMaxSelect(group?.maxSelect ?? 4);
    setSortOrder(group?.sortOrder ?? 0);
    setActive(group?.active ?? true);
    setOptions(
      group?.options?.length
        ? group.options.map((option) => ({ name: option.name, price: centsToInput(option.priceDeltaCents), active: option.active }))
        : [emptyOption()],
    );
    setError('');
    setBusy(false);
  }, [open, group]);

  function updateOption(index, field, value) {
    setOptions((previous) => previous.map((option, optionIndex) => optionIndex === index ? { ...option, [field]: value } : option));
  }

  function changeType(next) {
    setSelectionType(next);
    if (next === 'single') { setMaxSelect(1); setMinSelect(required ? 1 : 0); }
    else { setMaxSelect(Math.max(2, maxSelect)); setMinSelect(required ? 1 : 0); }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (!name.trim()) { setError('El nombre del grupo es obligatorio.'); return; }
    let parsedOptions;
    try {
      parsedOptions = options.map((option, index) => {
        if (!option.name.trim()) throw new Error(`La opción ${index + 1} necesita un nombre.`);
        return {
          name: option.name.trim(),
          priceDeltaCents: parseMoneyToCents(option.price),
          active: option.active,
          sortOrder: index * 10,
        };
      });
    } catch (parseError) {
      setError(parseError.message);
      return;
    }
    if (parsedOptions.length === 0) { setError('Agrega al menos una opción.'); return; }
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        selectionType,
        required,
        minSelect,
        maxSelect,
        sortOrder,
        active,
        options: parsedOptions,
      });
      onClose();
    } catch (submitError) {
      setError(submitError.message || 'No se pudo guardar el grupo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={group ? 'Editar grupo' : 'Nuevo grupo de modificadores'}
      subtitle="Opciones que el personal puede agregar a un producto."
      size="md"
      closeDisabled={busy}
      footer={
        <div className="modal-actions">
          <span />
          <div className="modal-actions-right">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="submit" form="modifier-form" className="btn btn-primary" disabled={busy}>
              {busy ? <span className="spinner spinner-small" /> : null}
              {group ? 'Guardar cambios' : 'Crear grupo'}
            </button>
          </div>
        </div>
      }
    >
      <form id="modifier-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full">
          <span className="field-label">Nombre del grupo</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ej. Extras, término de la carne…" autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Tipo de selección</span>
          <select className="input select" value={selectionType} onChange={(event) => changeType(event.target.value)}>
            <option value="single">Una sola opción</option>
            <option value="multiple">Varias opciones</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Orden</span>
          <input className="input" type="number" value={sortOrder} onChange={(event) => setSortOrder(Number(event.target.value))} />
        </label>
        <label className="field">
          <span className="field-label">Mínimo</span>
          <input className="input" type="number" min={0} max={20} value={minSelect} onChange={(event) => setMinSelect(Math.max(0, Number(event.target.value)))} />
        </label>
        <label className="field">
          <span className="field-label">Máximo</span>
          <input className="input" type="number" min={1} max={20} value={maxSelect} onChange={(event) => setMaxSelect(Math.max(1, Number(event.target.value)))} disabled={selectionType === 'single'} />
        </label>
        <label className="toggle-row field">
          <input type="checkbox" checked={required} onChange={(event) => {
            setRequired(event.target.checked);
            if (event.target.checked && minSelect < 1) setMinSelect(1);
            if (!event.target.checked && minSelect > 0) setMinSelect(0);
          }} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          <span><strong>Obligatorio</strong><small>El cajero debe elegir una opción.</small></span>
        </label>
        <label className="toggle-row field field-full">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          <span><strong>Grupo activo</strong><small>Los grupos inactivos no se muestran en el POS.</small></span>
        </label>

        <div className="field field-full">
          <div className="modifier-options-head">
            <span className="field-label">Opciones</span>
            <button type="button" className="btn btn-small btn-secondary" onClick={() => setOptions((previous) => [...previous, emptyOption()])}>
              <Icon name="plus" size={16} /> Opción
            </button>
          </div>
          <div className="option-editor-list">
            {options.map((option, index) => (
              <div key={index} className="option-editor-row">
                <input className="input" value={option.name} onChange={(event) => updateOption(index, 'name', event.target.value)} placeholder={`Opción ${index + 1}`} maxLength={80} />
                <div className="money-input-wrap">
                  <span className="money-prefix">₡</span>
                  <input className="input money-input" value={option.price} onChange={(event) => updateOption(index, 'price', event.target.value)} inputMode="decimal" placeholder="0.00" />
                </div>
                <label className="toggle-row option-active">
                  <input type="checkbox" checked={option.active} onChange={(event) => updateOption(index, 'active', event.target.checked)} />
                  <span className="toggle-track" aria-hidden="true"><span /></span>
                </label>
                <button type="button" className="icon-button" onClick={() => setOptions((previous) => previous.filter((_, i) => i !== index))} disabled={options.length === 1} aria-label="Eliminar opción">
                  <Icon name="trash" size={17} />
                </button>
              </div>
            ))}
          </div>
        </div>
        {error ? <p className="form-error field-full">{error}</p> : null}
      </form>
    </Modal>
  );
}
