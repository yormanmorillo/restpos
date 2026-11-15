'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { calculateChange, getSuggestedCashAmounts } from '@restpos/shared/pricing';
import { centsToInput, parseMoneyToCents } from '@restpos/shared/money';
import { api } from '@/lib/api';
import { formatMoney, paymentLabel, serviceLabel } from '@/lib/format';
import { compressImage, validateImageFile } from '@/lib/image';

const TIP_PRESETS = [
  { bps: 0, label: 'Sin propina' },
  { bps: 1000, label: '10%' },
  { bps: 1500, label: '15%' },
  { bps: 2000, label: '20%' },
];

function methodDescription(method) {
  if (method.kind === 'cash') return 'Calcula el cambio';
  if (method.kind === 'card') return 'Cobro exacto';
  if (method.kind === 'transfer') return 'Transferencia o comprobante';
  return 'Cobro exacto';
}

function methodIcon(method) {
  return method?.icon || (method?.kind === 'cash' ? 'cash' : method?.kind === 'card' ? 'card' : 'wallet');
}

export default function PaymentModal({ open, onClose, order, onSetTip, onConfirm, onRefresh }) {
  const [methods, setMethods] = useState([]);
  const [methodsLoading, setMethodsLoading] = useState(false);
  const [methodsError, setMethodsError] = useState('');
  const [methodCode, setMethodCode] = useState('');
  const [amountInput, setAmountInput] = useState('0.00');
  const [cashInput, setCashInput] = useState('0.00');
  const [customTip, setCustomTip] = useState('');
  const [tipError, setTipError] = useState('');
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);
  const [partialNotice, setPartialNotice] = useState('');
  const [photoFiles, setPhotoFiles] = useState([]);
  const [photoError, setPhotoError] = useState('');
  const [uploadingPayment, setUploadingPayment] = useState(null);
  const [shiftOpen, setShiftOpen] = useState(null);
  const [requireShift, setRequireShift] = useState(true);
  const [shiftLoading, setShiftLoading] = useState(false);
  const [shiftError, setShiftError] = useState('');

  const paidCents = Number(order.amountPaidCents ?? 0);
  const balanceCents = Math.max(0, Number(order.totalCents) - paidCents);
  const locked = paidCents > 0;
  const selectedMethod = methods.find((method) => method.code === methodCode) ?? null;
  const isCash = selectedMethod?.kind === 'cash';

  useEffect(() => {
    if (!open) return;
    setMethodCode('');
    setAmountInput(centsToInput(balanceCents));
    setCashInput(centsToInput(balanceCents));
    setCustomTip(order.tipType === 'fixed' ? centsToInput(order.tipValue) : '');
    setTipError('');
    setError('');
    setPaying(false);
    setPartialNotice('');
    setPhotoFiles([]);
    setPhotoError('');
    setMethodsLoading(true);
    setMethodsError('');
    setShiftLoading(true);
    setShiftError('');
    Promise.all([api.getPaymentMethods(), api.getCurrentShift(), api.getFeatures()])
      .then(([methodsResponse, shiftResponse, featuresResponse]) => {
        const active = (methodsResponse.methods ?? []).filter((method) => method.active);
        setMethods(active);
        setMethodCode(active.find((method) => method.code === 'efectivo')?.code ?? active[0]?.code ?? '');
        setShiftOpen(Boolean(shiftResponse.shift));
        setRequireShift(featuresResponse.features?.require_shift !== 'false');
      })
      .catch((loadError) => setMethodsError(loadError.message || 'No se pudieron cargar los métodos de pago.'))
      .finally(() => {
        setMethodsLoading(false);
        setShiftLoading(false);
      });
  }, [open]); // Solo al abrir.

  useEffect(() => {
    if (!open) return;
    setAmountInput(centsToInput(balanceCents));
    setCashInput(centsToInput(balanceCents));
    setError('');
  }, [open, balanceCents, order.totalCents]);

  const amountCents = useMemo(() => {
    try { return parseMoneyToCents(amountInput); } catch { return null; }
  }, [amountInput]);

  const receivedCents = useMemo(() => {
    if (!isCash) return null;
    try { return parseMoneyToCents(cashInput); } catch { return null; }
  }, [isCash, cashInput]);

  const amountError = useMemo(() => {
    if (amountCents === null) return 'Escribe un monto válido.';
    if (amountCents <= 0) return 'El monto debe ser mayor que cero.';
    if (amountCents > balanceCents) return `El saldo es ${formatMoney(balanceCents)}.`;
    return '';
  }, [amountCents, balanceCents]);

  const cashError = useMemo(() => {
    if (!isCash) return '';
    if (receivedCents === null) return 'Escribe un monto de efectivo válido.';
    if (amountCents !== null && receivedCents < amountCents) return `Faltan ${formatMoney(amountCents - receivedCents)} para cubrir este pago.`;
    return '';
  }, [isCash, receivedCents, amountCents]);

  const changeCents = isCash && receivedCents !== null && amountCents !== null && receivedCents >= amountCents
    ? calculateChange(amountCents, receivedCents)
    : null;
  const suggestions = useMemo(() => getSuggestedCashAmounts(amountCents ?? 0).slice(0, 5), [amountCents]);
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

  async function addPhotos(fileList, target = 'new') {
    const files = [...fileList];
    if (files.length === 0) return;
    setPhotoError('');
    for (const file of files) {
      const validation = validateImageFile(file);
      if (validation) { setPhotoError(validation); return; }
    }
    const compressed = await Promise.all(files.map((file) => compressImage(file)));
    if (target === 'new') {
      setPhotoFiles((previous) => [...previous, ...compressed].slice(0, 4));
    } else {
      setUploadingPayment(target);
      try {
        await api.uploadPaymentPhotos(order.id, target, compressed);
        await onRefresh?.();
        setPartialNotice('Comprobante adjuntado al pago.');
      } catch (uploadError) {
        setPhotoError(uploadError.message || 'No se pudo adjuntar el comprobante.');
      } finally {
        setUploadingPayment(null);
      }
    }
  }

  async function submit() {
    if (amountError) { setError(amountError); return; }
    if (cashError) { setError(cashError); return; }
    if (!selectedMethod) { setError('Selecciona un método de pago.'); return; }
    setPaying(true);
    setError('');
    try {
      const updated = await onConfirm({
        paymentMethod: selectedMethod.code,
        amountCents,
        ...(isCash ? { cashReceivedCents: receivedCents } : {}),
        photos: selectedMethod.allowsPhoto ? photoFiles : [],
      });
      setPhotoFiles([]);
      if (updated?.status === 'abierta') {
        setPartialNotice(`Pago de ${formatMoney(amountCents)} registrado. Saldo restante: ${formatMoney(updated.balanceCents)}.`);
      }
    } catch (confirmError) {
      setError(confirmError?.message || 'No se pudo completar el cobro.');
    } finally {
      setPaying(false);
    }
  }

  const shiftBlocked = shiftLoading || (requireShift && shiftOpen === false);
  const canConfirm = !paying && !shiftBlocked && !methodsLoading && Boolean(selectedMethod) && !amountError && !cashError && amountCents !== null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={paidCents > 0 ? 'Cobrar saldo' : 'Cobrar pedido'}
      subtitle={`${serviceLabel(order)} · ${order.orderNumber}`}
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
          {shiftLoading ? (
            <div className="payment-shift-note"><span className="spinner spinner-small" /> Verificando turno de caja…</div>
          ) : requireShift && shiftOpen === false ? (
            <div className="payment-shift-block" role="alert">
              <span className="payment-shift-icon"><Icon name="cash" size={20} /></span>
              <div>
                <strong>Abre un turno de caja para cobrar</strong>
                <span>La caja está cerrada. Debes abrirla antes de cobrar con <b>cualquier método de pago</b>.</span>
              </div>
              <a href="/caja" target="_blank" rel="noreferrer" className="btn btn-small btn-dark">Abrir caja</a>
            </div>
          ) : shiftError ? (
            <div className="inline-error"><Icon name="alert" size={16} /> {shiftError}</div>
          ) : null}
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
            {methodsLoading ? (
              <div className="payment-methods-loading"><span className="spinner spinner-small" /> Cargando métodos…</div>
            ) : methodsError ? (
              <div className="inline-error"><Icon name="alert" size={16} /> {methodsError}</div>
            ) : (
              <div className="payment-methods">
                {methods.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    className={`payment-method ${methodCode === item.code ? 'is-selected' : ''}`}
                    onClick={() => { setMethodCode(item.code); setError(''); }}
                    disabled={paying || shiftBlocked}
                  >
                    <Icon name={methodIcon(item)} size={24} />
                    <strong>{item.name}</strong>
                    <span>{methodDescription(item)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="payment-section">
            <div className="payment-section-row">
              <h3>Monto del pago</h3>
              <span className="field-hint">Saldo {formatMoney(balanceCents)}</span>
            </div>
            <div className="money-input-wrap money-input-large">
              <span className="money-prefix">₡</span>
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

          {isCash ? (
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
                <span className="money-prefix">₡</span>
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
              <Icon name={methodIcon(selectedMethod)} size={22} />
              <div>
                <strong>{selectedMethod?.name ?? 'Cobro'} por {formatMoney(amountCents ?? 0)}</strong>
                <span>Registra el pago cuando lo recibas. No se calcula cambio.</span>
              </div>
            </div>
          )}

          {selectedMethod?.allowsPhoto ? (
            <section className="payment-section photo-section">
              <div className="payment-section-row">
                <h3>Comprobante (opcional)</h3>
                <span className="field-hint">JPG, PNG o WebP</span>
              </div>
              <p className="photo-hint"><Icon name="phone" size={15} /> Adjunta una foto del comprobante de {selectedMethod.name} para dejarlo en la auditoría del pago.</p>
              <div className="photo-grid">
                {photoFiles.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="photo-preview">
                    <img src={URL.createObjectURL(file)} alt={`Comprobante ${index + 1}`} />
                    <button type="button" onClick={() => setPhotoFiles((previous) => previous.filter((_, i) => i !== index))} aria-label="Quitar comprobante">
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
                {photoFiles.length < 4 ? (
                  <label className="photo-add">
                    <Icon name="plus" size={20} />
                    <span>Agregar foto</span>
                    <input type="file" accept="image/*" multiple onChange={(event) => void addPhotos(event.target.files)} />
                  </label>
                ) : null}
              </div>
              {photoError ? <p className="field-error">{photoError}</p> : null}
            </section>
          ) : null}
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
                      <span className="money-prefix">₡</span>
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
              {payments.map((payment) => {
                const method = methods.find((item) => item.code === payment.paymentMethod);
                return (
                  <div key={payment.id} className="payment-history-entry">
                    <div className="payment-history-row">
                      <span><Icon name={methodIcon(method) || 'wallet'} size={15} /> {payment.paymentMethodName || paymentLabel(payment.paymentMethod)}</span>
                      <strong>{formatMoney(payment.amountCents)}</strong>
                    </div>
                    {(payment.photos ?? []).length > 0 ? (
                      <div className="payment-photo-links">
                        {payment.photos.map((photo, index) => (
                          <a key={photo.id} href={photo.url} target="_blank" rel="noreferrer"><Icon name="receipt" size={13} /> Comprobante {index + 1}</a>
                        ))}
                      </div>
                    ) : null}
                    {(method?.allowsPhoto ?? ['sinpe', 'transferencia'].includes(payment.paymentMethod)) ? (
                      <label className="text-button payment-attach-link">
                        {uploadingPayment === payment.id ? 'Subiendo…' : (payment.photos ?? []).length ? 'Agregar otra foto' : 'Adjuntar comprobante'}
                        <input type="file" accept="image/*" multiple disabled={uploadingPayment === payment.id} onChange={(event) => void addPhotos(event.target.files, payment.id)} />
                      </label>
                    ) : null}
                  </div>
                );
              })}
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
