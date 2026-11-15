'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { formatMoney } from '@/lib/format';

function buildParts(count, items) {
  return Array.from({ length: count }, (_, index) => ({
    label: `Persona ${index + 1}`,
    itemIds: [],
  })).map((part, index) => ({
    ...part,
    itemIds: items.filter((_, itemIndex) => itemIndex % count === index).map((item) => item.id),
  }));
}

export default function SplitBillModal({ open, order, onClose, onSave }) {
  const [parts, setParts] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setParts(buildParts(Math.min(2, order.items.length), order.items));
    setError('');
    setBusy(false);
  }, [open, order]);

  const assigned = useMemo(() => new Set(parts.flatMap((part) => part.itemIds)), [parts]);
  const unassigned = order.items.filter((item) => !assigned.has(item.id));

  function setPartCount(count) {
    setParts(buildParts(count, order.items));
    setError('');
  }

  function assign(itemId, partIndex) {
    setParts((previous) => previous.map((part, index) => ({
      ...part,
      itemIds: index === partIndex
        ? [...new Set([...part.itemIds, itemId])]
        : part.itemIds.filter((id) => id !== itemId),
    })));
  }

  async function save() {
    if (parts.some((part) => part.itemIds.length === 0)) {
      setError('Cada parte debe tener al menos un producto.');
      return;
    }
    if (unassigned.length > 0) {
      setError('Asigna todos los productos a una persona.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSave(parts.map((part) => ({ label: part.label.trim(), itemIds: part.itemIds })));
      onClose();
    } catch (saveError) {
      setError(saveError.message || 'No se pudo dividir la cuenta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Dividir cuenta"
      subtitle={`${order.orderNumber} · ${formatMoney(order.totalCents)}`}
      size="md"
      closeDisabled={busy}
      footer={
        <div className="modal-actions">
          <span />
          <div className="modal-actions-right">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || unassigned.length > 0}>
              {busy ? <span className="spinner spinner-small" /> : <Icon name="split" size={18} />}
              Crear {parts.length} partes
            </button>
          </div>
        </div>
      }
    >
      <p className="field-hint">Asigna cada producto a una persona o asiento. El descuento y la propina deben quitarse antes de dividir.</p>
      <div className="quick-options split-count-options">
        {[2, 3, 4, 5].filter((count) => count <= order.items.length).map((count) => (
          <button key={count} type="button" className={`quick-chip ${parts.length === count ? 'is-active' : ''}`} onClick={() => setPartCount(count)}>
            {count} partes
          </button>
        ))}
      </div>
      <div className="split-parts">
        {parts.map((part, partIndex) => (
          <label key={partIndex} className="field split-part-name">
            <span className="field-label">Parte {partIndex + 1}</span>
            <input className="input" value={part.label} maxLength={40} onChange={(event) => setParts((previous) => previous.map((entry, index) => index === partIndex ? { ...entry, label: event.target.value } : entry))} />
          </label>
        ))}
      </div>
      <div className="split-item-list">
        {order.items.map((item) => {
          const ownerIndex = parts.findIndex((part) => part.itemIds.includes(item.id));
          return (
            <div key={item.id} className="split-item-row">
              <div><strong>{item.quantity} × {item.productName}</strong><span>{formatMoney(item.lineTotalCents)}</span></div>
              <select className="input select split-item-select" value={ownerIndex} onChange={(event) => assign(item.id, Number(event.target.value))}>
                {parts.map((part, index) => <option key={index} value={index}>{part.label || `Parte ${index + 1}`}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      {unassigned.length > 0 ? <p className="form-error">Hay {unassigned.length} producto(s) sin asignar.</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
    </Modal>
  );
}
