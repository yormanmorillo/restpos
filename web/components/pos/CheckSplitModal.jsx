'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { formatMoney } from '@/lib/format';

const MODES = [
  { key: 'equal', label: 'Partes iguales' },
  { key: 'person', label: 'Por persona' },
  { key: 'plates', label: 'Por platos' },
];

function makeMatrix(items, count) {
  const matrix = {};
  for (const item of items) {
    matrix[item.id] = Array.from({ length: count }, (_, index) => index === 0 ? item.quantity : 0);
  }
  return matrix;
}

export default function CheckSplitModal({ open, order, onClose, onEqual, onGroups }) {
  const [mode, setMode] = useState('equal');
  const [count, setCount] = useState(2);
  const [labels, setLabels] = useState(['Persona 1', 'Persona 2']);
  const [matrix, setMatrix] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const initial = Math.min(4, Math.max(2, order.items.length));
    setMode('equal');
    setCount(initial);
    setLabels(Array.from({ length: initial }, (_, index) => `Persona ${index + 1}`));
    setMatrix(makeMatrix(order.items, initial));
    setError('');
    setBusy(false);
  }, [open, order]);

  function changeCount(next) {
    const value = Math.min(8, Math.max(2, Number(next) || 2));
    setCount(value);
    setLabels((previous) => Array.from({ length: value }, (_, index) => previous[index] ?? `Persona ${index + 1}`));
    setMatrix(makeMatrix(order.items, value));
    setError('');
  }

  function setQuantity(itemId, checkIndex, value) {
    setMatrix((previous) => ({
      ...previous,
      [itemId]: previous[itemId].map((quantity, index) => index === checkIndex ? Math.max(0, Math.min(order.items.find((item) => item.id === itemId).quantity, Number(value) || 0)) : quantity),
    }));
  }

  const assignedByCheck = useMemo(() => Array.from({ length: count }, (_, index) => order.items.reduce((sum, item) => sum + (matrix[item.id]?.[index] ?? 0), 0)), [matrix, count, order.items]);
  const allAssigned = order.items.every((item) => (matrix[item.id] ?? []).reduce((sum, quantity) => sum + quantity, 0) === item.quantity);

  async function save() {
    setBusy(true); setError('');
    try {
      if (mode === 'equal') {
        await onEqual(count);
      } else {
        if (!allAssigned) { setError('Asigna toda la cantidad de cada producto.'); setBusy(false); return; }
        const groups = labels.map((label, index) => ({
          label,
          shares: order.items.filter((item) => (matrix[item.id]?.[index] ?? 0) > 0).map((item) => ({ orderItemId: item.id, quantityMilli: (matrix[item.id][index] ?? 0) * 1000 })),
        }));
        if (groups.some((group) => group.shares.length === 0)) { setError('Cada cuenta debe tener al menos un producto.'); setBusy(false); return; }
        await onGroups(groups);
      }
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'No se pudo dividir la cuenta.');
    } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Dividir cuenta" subtitle={`${order.orderNumber} · ${formatMoney(order.totalCents)}`} size="lg" closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>{busy ? <span className="spinner spinner-small" /> : <Icon name="split" size={18} />} Crear cuentas</button></div></div>}>
      <div className="check-mode-tabs" role="tablist">
        {MODES.map((entry) => <button key={entry.key} type="button" role="tab" aria-selected={mode === entry.key} className={`check-mode-tab ${mode === entry.key ? 'is-active' : ''}`} onClick={() => setMode(entry.key)}>{entry.label}</button>)}
      </div>
      <div className="check-count-row"><span className="field-label">Cuentas</span>{[2, 3, 4, 5, 6].map((value) => <button key={value} type="button" className={`quick-chip ${count === value ? 'is-active' : ''}`} onClick={() => changeCount(value)}>{value}</button>)}</div>
      {mode === 'equal' ? (
        <div className="check-equal-preview"><Icon name="split" size={26} /><p>Se repartirán todos los productos y el total en <strong>{count} partes</strong> por mayor residuo.</p></div>
      ) : (
        <>
          <p className="field-hint">{mode === 'person' ? 'Asigna cada producto a una persona. Puedes repartir una cantidad entre varias cuentas.' : 'Asigna platos o cantidades a cada cuenta; una línea de cantidad 2 se puede partir 1 y 1.'}</p>
          <div className="check-labels">{labels.map((label, index) => <label key={index} className="field"><span className="field-label">Cuenta {index + 1}</span><input className="input" value={label} maxLength={40} onChange={(event) => setLabels((previous) => previous.map((entry, position) => position === index ? event.target.value : entry))} /></label>)}</div>
          <div className="check-assignment-table">
            <div className="check-assignment-head"><span>Producto</span>{labels.map((label, index) => <span key={index}>{label || `Cuenta ${index + 1}`}</span>)}</div>
            {order.items.map((item) => (
              <div key={item.id} className="check-assignment-row">
                <div><strong>{item.productName}</strong><span>{item.quantity} × {formatMoney(item.unitPriceCents)}</span></div>
                {Array.from({ length: count }, (_, index) => <input key={index} className="input input-tiny" type="number" min={0} max={item.quantity} value={matrix[item.id]?.[index] ?? 0} onChange={(event) => setQuantity(item.id, index, event.target.value)} />)}
              </div>
            ))}
          </div>
          <p className={`field-hint ${allAssigned ? '' : 'is-error'}`}>{allAssigned ? 'Cantidades completas.' : 'Faltan cantidades por asignar.'} {assignedByCheck.map((value, index) => `${labels[index] || `Cuenta ${index + 1}`}: ${value}`).join(' · ')}</p>
        </>
      )}
      {error ? <p className="form-error">{error}</p> : null}
    </Modal>
  );
}
