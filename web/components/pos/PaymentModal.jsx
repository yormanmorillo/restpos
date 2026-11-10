'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { calculateChange, getSuggestedCashAmounts } from '@restpos/shared/pricing';
import { centsToInput, parseMoneyToCents } from '@restpos/shared/money';
import { formatMoney } from '@/lib/format';

const TIP_PRESETS = [
  { bps: 0, label: 'Sin propina' },
  { bps: 1000, label: '10%' },
  { bps: 1500, label: '15%' },
  { bps: 2000, label: '20%' },
];

const METHODS = [
  { value: 'efectivo', label: 'Efectivo', description: 'Calcula el cambio', icon: 'cash' },
  { value: 'tarjeta', label: 'Tarjeta', description: 'Cobro exacto', icon: 'card' },
  { value: 'otro', label: 'Otro', description: 'Transferencia u otro', icon: 'wallet' },
];

export default function PaymentModal({ open, onClose, order, onSetTip, onConfirm }) {
  const [method, setMethod] = useState('efectivo');
  const [cashInput, setCashInput] = useState(centsToInput(order.totalCents));
  const [customTip, setCustomTip] = useState('');
  const [tipError, setTipError] = useState('');
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMethod('efectivo');
    setCashInput(centsToInput(order.totalCents));
    setCustomTip(order.tipType === 'fixed' ? centsToInput(order.tipValue) : '');
    setTipError('');
    setError('');
    setPaying(false);
  }, [open]); // El total cambia al ajustar la propina; no reiniciamos el efectivo aquí.

  useEffect(() => {
    if (!open) return;
    setCashInput(centsToInput(order.totalCents));
  }, [open, order.totalCents]);

  const receivedCents = useMemo(() => {
    if (method !== 'efectivo') return null;
    try {
      return parseMoneyToCents(cashInput);
    } catch {
      return null;
    }
  }, [method, cashInput]);

  const cashError = useMemo(() => {
    if (method !== 'efectivo') return '';
    if (receivedCents === null) return 'Escribe un monto de efectivo válido.';
    if (receivedCents < order.totalCents) {
      return `Faltan ${formatMoney(order.totalCents - receivedCents)} para cubrir el total.`;
    }
    return '';
  }, [method, receivedCents, order.totalCents]);

  const changeCents =
    method === 'efectivo' && receivedCents !== null && receivedCents >= order.totalCents
      ? calculateChange(order.totalCents, receivedCents)
      : null;

  const suggestions = useMemo(() => getSuggestedCashAmounts(order.totalCents).slice(0, 5), [order.totalCents]);
  const activePercentTip = order.tipType === 'percent' ? order.tipValue : null;

  function applyCustomTip() {
    try {
      const cents = parseMoneyToCents(customTip);
      onSetTip(cents === 0 ? 'none' : 'fixed', cents);
      setTipError('');
    } catch (tipParseError) {
      setTipError(tipParseError.message);
    }
  }

  async function submit() {
    if (cashError) {
      setError(cashError);
      return;
    }
    setPaying(true);
    setError('');
    try {
      await onConfirm({
        paymentMethod: method,
        ...(method === 'efectivo' ? { cashReceivedCents: receivedCents } : {}),
      });
    } catch (confirmError) {
      setError(confirmError?.message || 'No se pudo completar el cobro.');
      setPaying(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cobrar pedido"
      subtitle={`${order.type === 'mesa' ? order.tableName : 'Para llevar'} · ${order.orderNumber}`}
      size="lg"
      closeDisabled={paying}
      footer={
        <div className="payment-footer">
          <div>
            <span>Total a cobrar</span>
            <strong>{formatMoney(order.totalCents)}</strong>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-charge-confirm"
            onClick={() => void submit()}
            disabled={paying || Boolean(cashError) || order.totalCents < 0}
          >
            {paying ? (
              <>
                <span className="spinner spinner-small" aria-hidden="true" />
                Procesando…
              </>
            ) : (
              <>
                <Icon name="check" size={21} />
                Cobrar {formatMoney(order.totalCents)}
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="payment-layout">
        <div className="payment-main">
          <section className="payment-section">
            <h3>Método de pago</h3>
            <div className="payment-methods">
              {METHODS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`payment-method ${method === item.value ? 'is-selected' : ''}`}
                  onClick={() => setMethod(item.value)}
                  disabled={paying}
                >
                  <Icon name={item.icon} size={26} />
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
          </section>

          {method === 'efectivo' ? (
            <section className="payment-section">
              <h3>Efectivo recibido</h3>
              <div className="quick-options">
                {suggestions.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    className={`quick-chip cash-chip ${receivedCents === amount ? 'is-active' : ''}`}
                    onClick={() => setCashInput(centsToInput(amount))}
                    disabled={paying}
                  >
                    {amount === order.totalCents ? 'Exacto' : formatMoney(amount)}
                  </button>
                ))}
              </div>
              <label className="field">
                <span className="field-label">Monto recibido</span>
                <div className="money-input-wrap money-input-large">
                  <span className="money-prefix">$</span>
                  <input
                    className="input money-input"
                    type="text"
                    inputMode="decimal"
                    value={cashInput}
                    onChange={(event) => setCashInput(event.target.value)}
                    disabled={paying}
                    aria-invalid={Boolean(cashError)}
                  />
                </div>
              </label>
              <div className={`change-box ${changeCents !== null ? 'has-change' : ''}`}>
                <span>Cambio</span>
                <strong>{changeCents === null ? '—' : formatMoney(changeCents)}</strong>
              </div>
              {cashError ? <p className="field-error">{cashError}</p> : null}
            </section>
          ) : (
            <div className="payment-exact-note">
              <Icon name="card" size={22} />
              <div>
                <strong>Cobro exacto por {formatMoney(order.totalCents)}</strong>
                <span>Registra el pago cuando lo recibas. No se calcula cambio.</span>
              </div>
            </div>
          )}
        </div>

        <aside className="payment-side">
          <section className="payment-section">
            <h3>Propina</h3>
            <div className="tip-grid">
              {TIP_PRESETS.map((preset) => {
                const selected =
                  preset.bps === 0
                    ? order.tipType === 'none' || order.tipCents === 0
                    : activePercentTip === preset.bps;
                return (
                  <button
                    key={preset.bps}
                    type="button"
                    className={`quick-chip tip-chip ${selected ? 'is-active' : ''}`}
                    onClick={() => onSetTip(preset.bps === 0 ? 'none' : 'percent', preset.bps)}
                    disabled={paying}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <div className="custom-tip">
              <label className="field">
                <span className="field-label">Propina en monto</span>
                <div className="inline-action">
                  <div className="money-input-wrap">
                    <span className="money-prefix">$</span>
                    <input
                      className="input money-input"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={customTip}
                      onChange={(event) => {
                        setCustomTip(event.target.value);
                        setTipError('');
                      }}
                      disabled={paying}
                    />
                  </div>
                  <button type="button" className="btn btn-small btn-secondary" onClick={applyCustomTip} disabled={paying}>
                    Aplicar
                  </button>
                </div>
              </label>
              {tipError ? <p className="field-error">{tipError}</p> : null}
            </div>
          </section>

          <section className="payment-summary" aria-label="Resumen del cobro">
            <div className="summary-row">
              <span>Subtotal</span>
              <span>{formatMoney(order.subtotalCents)}</span>
            </div>
            {order.discountCents > 0 ? (
              <div className="summary-row summary-discount">
                <span>Descuento</span>
                <span>-{formatMoney(order.discountCents)}</span>
              </div>
            ) : null}
            <div className="summary-row">
              <span>Impuesto ({order.taxRateBps / 100}%)</span>
              <span>{formatMoney(order.taxCents)}</span>
            </div>
            <div className="summary-row">
              <span>Propina</span>
              <span>{formatMoney(order.tipCents)}</span>
            </div>
            <div className="summary-row summary-total">
              <span>Total</span>
              <strong>{formatMoney(order.totalCents)}</strong>
            </div>
          </section>
        </aside>
      </div>

      {error ? (
        <div className="alert alert-error payment-error" role="alert">
          <Icon name="alert" size={19} />
          <p>{error}</p>
        </div>
      ) : null}
    </Modal>
  );
}
