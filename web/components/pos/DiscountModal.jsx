'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { centsToInput, parseMoneyToCents, parsePercentToBps } from '@restpos/shared/money';
import { formatMoney } from '@/lib/format';

const PERCENT_PRESETS = [5, 10, 15, 20];
const ROLE_LIMITS = { server: 10, cashier: 10, manager: 25, admin: 100, owner: 100 };


export default function DiscountModal({ open, onClose, order, onApply, staffRole = 'server' }) {
  const [type, setType] = useState('percent');
  const [value, setValue] = useState('10');
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setReason(order.discountReason ?? '');
    if (order.discountType === 'percent') {
      setType('percent');
      setValue(String(order.discountValue / 100));
    } else if (order.discountType === 'fixed') {
      setType('fixed');
      setValue(centsToInput(order.discountValue));
    } else {
      setType('percent');
      setValue('10');
    }
  }, [open, order.discountType, order.discountValue]);

  function applyDiscount() {
    try {
      if (type === 'none') {
        onApply('none', 0, '');
        onClose();
        return;
      }
      const parsed = type === 'percent' ? parsePercentToBps(value) : parseMoneyToCents(value);
      if (parsed === 0) {
        setError('El descuento debe ser mayor que cero.');
        return;
      }
      if (reason.trim().length < 3) {
        setError('Indica el motivo del descuento (mínimo 3 caracteres).');
        return;
      }
      onApply(type, parsed, reason.trim());
      onClose();
    } catch (applyError) {
      setError(applyError.message);
    }
  }

  const label = type === 'percent' ? 'porcentaje' : 'monto';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Aplicar descuento"
      subtitle="El descuento se aplica antes de calcular el impuesto."
      size="sm"
      footer={
        <div className="modal-actions">
          {order.discountType !== 'none' ? (
            <button
              type="button"
              className="btn btn-danger-quiet"
              onClick={() => {
                onApply('none', 0, '');
                onClose();
              }}
            >
              Quitar descuento
            </button>
          ) : (
            <span />
          )}
          <div className="modal-actions-right">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className="btn btn-primary" onClick={applyDiscount} disabled={type === 'none'}>
              Aplicar
            </button>
          </div>
        </div>
      }
    >
      <div className="field">
        <span className="field-label">Tipo de descuento</span>
        <div className="segmented-control">
          <button
            type="button"
            className={type === 'percent' ? 'is-selected' : ''}
            onClick={() => {
              setType('percent');
              setValue('10');
              setError('');
            }}
          >
            <Icon name="percent" size={18} />
            Porcentaje
          </button>
          <button
            type="button"
            className={type === 'fixed' ? 'is-selected' : ''}
            onClick={() => {
              setType('fixed');
              setValue('50.00');
              setError('');
            }}
          >
            <Icon name="coin" size={18} />
            Monto fijo
          </button>
        </div>
      </div>

      {type === 'percent' ? (
        <div className="field">
          <span className="field-label">Descuentos rápidos</span>
          <div className="quick-options">
            {PERCENT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`quick-chip ${Number(value) === preset ? 'is-active' : ''}`}
                onClick={() => {
                  setValue(String(preset));
                  setError('');
                }}
              >
                {preset}%
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <label className="field">
        <span className="field-label">Descuento ({label})</span>
        <div className="money-input-wrap">
          <span className="money-prefix">{type === 'percent' ? '%' : '$'}</span>
          <input
            className="input money-input"
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
            autoFocus
            aria-invalid={Boolean(error)}
          />
        </div>
        {error ? <span className="field-error">{error}</span> : null}
      </label>

      <div className="calculation-note">
        <span>Subtotal actual</span>
        <strong>{formatMoney(order.subtotalCents)}</strong>
      </div>
      <div className="calculation-note">
        <span>Límite de tu rol</span>
        <strong>{ROLE_LIMITS[staffRole] ?? 10}% del subtotal</strong>
      </div>
      <label className="field">
        <span className="field-label">Motivo del descuento <small>(obligatorio)</small></span>
        <textarea
          className="input"
          rows={2}
          maxLength={200}
          value={reason}
          onChange={(event) => { setReason(event.target.value); setError(''); }}
          placeholder="Ej. cliente frecuente, promoción, cortesía autorizada…"
        />
      </label>
    </Modal>
  );
}
