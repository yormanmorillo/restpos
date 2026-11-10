'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { calculateChange, getSuggestedCashAmounts } from '@restpos/shared/pricing';
import { centsToInput, parseMoneyToCents } from '@restpos/shared/money';
import { formatMoney, paymentLabel } from '@/lib/format';

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
  const [amountInput, setAmountInput] = useState('0.00');
  const [cashInput, setCashInput] = useState('0.00');
  const [customTip, setCustomTip] = useState('');
  const [tipError, setTipError] = useState('');
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [partialNotice, setPartialNotice] = useState('');

  const paidCents = Number(order.amountPaidCents ?? 0);
  const balanceCents = Math.max(0, Number(order.totalCents) - paidCents);
  const locked = paidCents > 0;

  useEffect(() => {
    if (!open) return;
    setMethod('efectivo');
    setAmountInput(centsToInput(balanceCents));
    setCashInput(centsToInput(balanceCents));
    setCustomTip(order.tipType === 'fixed' ? centsToInput(order.tipValue) : '');
    setTipError('');
    setError('');
    setPaying(false);
    setPartialNotice('');
  }, [open]); // Al abrir, no en cada cambio de saldo.

  useEffect(() => {
    if (!open) return;
    setAmountInput(centsToInput(balanceCents));
    setCashInput(centsToInput(balanceCents));
    setPartialNotice('');
    setError('');
  }, [open, balanceCents, order.totalCents]);

  const amountCents = useMemo(() => {
    try {
      return parseMoneyToCents(amountInput);
    } catch {
      return null;
    }
  }, [amountInput]);

  const receivedCents = useMemo(() => {
    if (method !== 'efectivo') return null;
    try {
      return parseMoneyToCents(cashInput);
    } catch {
      return null;
    }
  }, [method, cashInput]);

  const amountError = useMemo(() => {
    if (amountCents === null) return 'Escribe un monto válido.';
    if (amountCents <= 0) return 'El monto debe ser mayor que cero.';
    if (amountCents > balanceCents) return `El saldo es ${formatMoney(balanceCents)}.`;
    return '';
  }, [amountCents, balanceCents]);

  const cashError = useMemo(() => {
    if (method !== 'efectivo') return '';
    if (receivedCents === null) return 'Escribe un monto de efectivo válido.';
    if (amountCents !== null && receivedCents < amountCents) {
      return `Faltan ${formatMoney(amountCents - receivedCents)} para cubrir este pago.`;
    }
    return '';
  }, [method, receivedCents, amountCents]);

  const changeCents =
    method === 'efectivo' && receivedCents !== null && amountCents !== null && receivedCents >= amountCents
      ? calculateChange(amountCents, receivedCents)
      : null;

  const suggestions = useMemo(
    () => getSuggestedCashAmounts(amountCents ?? 0).slice(0, 5),
    [amountCents],
  );
  const activePercentTip = order.tipType === 'percent' ? order.tipValue : null;
  const payments = order.payments ?? [];

  function useSplit(parts) {
    if (!Number.isInteger(parts) || parts < 2) return;
    const share = Math.ceil(balanceCents / parts);
    setAmountInput(centsToInput(share));
    setCashInput(centsToInput(share));
    setError('');
  }

  function applyCustomTip() {
    if (locked) return;
    try {
      const cents = parseMoneyToCents(customTip);
      onSetTip(cents === 0 ? 'none' : 'fixed', cents);
      setTipError('');
    } catch (tipParseError) {
      setTipError(tipParseError.message);
    }
  }

  async function submit() {
    if (amountError) {
      setError(amountError);
      return;
    }
    if (cashError) {
      setError(cashError);
      return;
    }
    setPaying(true);
    setError('');
    try {
      const updated = await onConfirm({
        paymentMethod: method,
        amountCents,
        ...(method === 'efectivo' ? { cashReceivedCents: receivedCents } : {}),
      });
      if (updated?.status === 'abierta') {
        setPartialNotice(`Pago de ${formatMoney(amountCents)} registrado. Saldo restante: ${formatMoney(updated.balanceCents)}.`);
      }
    } catch (confirmError) {
      setError(confirmError?.message || 'No se pudo completar el cobro.');
    } finally {
      setPaying(false);
    }
  }

  const canConfirm = !paying && !amountError && !cashError && amountCents !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={paidCents > 0 ? 'Cobrar saldo' : 'Cobrar pedido'}
      subtitle={`${order.type === 'mesa' ? order.tableName : order.delivery ? 'Delivery' : 'Para llevar'} · ${order.orderNumber}`}
      size="lg"
      closeDisabled={paying}
      footer={
        <div className="payment-footer">
          <div>
            <span>{paidCents > 0 ? 'Saldo pendiente' : 'Total a cobrar'}</span>
            <strong>{formatMoney(balanceCents)}</strong>
          </div>
          <button type="button" className="btn btn-primary btn-charge-confirm" onClick={() => void submit()} disabled={!canConfirm}>
            {paying ? (
              <><span className="spinner spinner-small" aria-hidden="true" /> Procesando…</>
            ) : (
              <><Icon name="check" size={21} /> Cobrar {formatMoney(amountCents ?? 0)}</>
            )}
          </button>
        </div>
      }
    >
      <div className="payment-layout">
        <div className="payment-main">
          {partialNotice ? (
            <div className="alert alert-success"><Icon name="check" size={18} /><p>{partialNotice}</p></div>
          ) : null}
          {paidCents > 0 ? (
            <div className="partial-banner">
              <Icon name="split" size={20} />
              <div><strong>Pago parcial</strong><span>{formatMoney(paidCents)} pagados de {formatMoney(order.totalCents)}</span></div>
            </div>
          ) : null}

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
                  <Icon name={item.icon} size={24} />
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="payment-section">
            <div className="payment-section-row">
              <h3>Monto del pago</h3>
              <span className="field-hint">Saldo {formatMoney(balanceCents)}</span>
            </div>
            <div className="money-input-wrap money-input-large">
              <span className="money-prefix">$</span>
              <input
                className="input money-input"
                type="text"
                inputMode="decimal"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                disabled={paying || balanceCents <= 0}
                aria-invalid={Boolean(amountError)}
              />
            </div>
            <div className="quick-options split-options">
              <button type="button" className="quick-chip" onClick={() => setAmountInput(centsToInput(balanceCents))} disabled={paying}>Saldo total</button>
              {balanceCents >= 200 && (
                <>
                  <button type="button" className="quick-chip" onClick={() => useSplit(2)} disabled={paying}>1/2</button>
                  <button type="button" className="quick-chip" onClick={() => useSplit(3)} disabled={paying}>1/3</button>
                  <button type="button" className="quick-chip" onClick={() => useSplit(4)} disabled={paying}>1/4</button>
                </>
              )}
            </div>
            {amountError ? <p className="field-error">{amountError}</p> : null}
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
                    {amount === amountCents ? 'Exacto' : formatMoney(amount)}
                  </button>
                ))}
              </div>
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
                <strong>Cobro exacto por {formatMoney(amountCents ?? 0)}</strong>
                <span>Registra el pago cuando lo recibas. No se calcula cambio.</span>
              </div>
            </div>
          )}
        </div>

        <aside className="payment-side">
          <section className="payment-section">
            <div className="payment-section-row">
              <h3>Propina</h3>
              {locked ? <span className="field-hint">Bloqueada por pago parcial</span> : null}
            </div>
            <div className="tip-grid">
              {TIP_PRESETS.map((preset) => {
                const selected = preset.bps === 0
                  ? order.tipType === 'none' || order.tipCents === 0
                  : activePercentTip === preset.bps;
                return (
                  <button
                    key={preset.bps}
                    type="button"
                    className={`quick-chip tip-chip ${selected ? 'is-active' : ''}`}
                    onClick={() => onSetTip(preset.bps === 0 ? 'none' : 'percent', preset.bps)}
                    disabled={paying || locked}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            {!locked ? (
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
                        onChange={(event) => { setCustomTip(event.target.value); setTipError(''); }}
                        disabled={paying}
                      />
                    </div>
                    <button type="button" className="btn btn-small btn-secondary" onClick={applyCustomTip} disabled={paying}>Aplicar</button>
                  </div>
                </label>
                {tipError ? <p className="field-error">{tipError}</p> : null}
              </div>
            ) : null}
          </section>

          <section className="payment-summary" aria-label="Resumen del cobro">
            <div className="summary-row"><span>Subtotal</span><span>{formatMoney(order.subtotalCents)}</span></div>
            {order.discountCents > 0 ? <div className="summary-row summary-discount"><span>Descuento</span><span>-{formatMoney(order.discountCents)}</span></div> : null}
            <div className="summary-row"><span>Impuesto ({order.taxRateBps / 100}%)</span><span>{formatMoney(order.taxCents)}</span></div>
            {order.deliveryFeeCents > 0 ? <div className="summary-row"><span>Costo de entrega</span><span>{formatMoney(order.deliveryFeeCents)}</span></div> : null}
            <div className="summary-row"><span>Propina</span><span>{formatMoney(order.tipCents)}</span></div>
            <div className="summary-row summary-total"><span>Total</span><strong>{formatMoney(order.totalCents)}</strong></div>
            {paidCents > 0 ? <div className="summary-row summary-balance"><span>Saldo</span><span>{formatMoney(balanceCents)}</span></div> : null}
          </section>

          {payments.length > 0 ? (
            <section className="payment-history">
              <h3>Pagos registrados</h3>
              {payments.map((payment) => (
                <div key={payment.id} className="payment-history-row">
                  <span><Icon name={payment.paymentMethod === 'efectivo' ? 'cash' : payment.paymentMethod === 'tarjeta' ? 'card' : 'wallet'} size={15} /> {paymentLabel(payment.paymentMethod)}</span>
                  <strong>{formatMoney(payment.amountCents)}</strong>
                </div>
              ))}
            </section>
          ) : null}
        </aside>
      </div>

      {error ? (
        <div className="alert alert-error payment-error" role="alert">
          <Icon name="alert" size={19} />
          <div className="payment-error-copy">
            <p>{error}</p>
            {error.toLowerCase().includes('turno') ? <a href="/caja" target="_blank" rel="noreferrer" className="text-button">Abrir caja en otra pestaña</a> : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
