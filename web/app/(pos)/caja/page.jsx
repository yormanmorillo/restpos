'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { useAuth } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api';
import { formatMoney, formatTime, serviceLabel } from '@/lib/format';
import KitchenQueue from '@/components/KitchenQueue';
import { parseMoneyToCents, centsToInput } from '@restpos/shared/money';

export default function CashPage() {
  const { staff } = useAuth();
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [openOrders, setOpenOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [openingInput, setOpeningInput] = useState('0.00');
  const [openNotes, setOpenNotes] = useState('');
  const [countedInput, setCountedInput] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [currentResponse, historyResponse, ordersResponse] = await Promise.all([
        api.getCurrentShift(),
        api.getShifts(),
        api.getOrders({ status: 'abierta', limit: 100 }),
      ]);
      setCurrent(currentResponse.shift ? currentResponse : null);
      setHistory(historyResponse.shifts ?? []);
      setOpenOrders(ordersResponse.orders ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar la caja.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canOperate = ['admin', 'manager', 'cashier'].includes(staff?.role);

  async function openShift() {
    setFormError('');
    let openingCents;
    try {
      openingCents = parseMoneyToCents(openingInput);
    } catch (parseError) {
      setFormError(parseError.message);
      return;
    }
    setBusy(true);
    try {
      const response = await api.openShift({ openingCents, notes: openNotes.trim() });
      setCurrent(response);
      setOpenModal(false);
      setOpenNotes('');
      window.dispatchEvent(new CustomEvent('restpos:shift-changed'));
      await load();
    } catch (shiftError) {
      setFormError(shiftError.message || 'No se pudo abrir el turno.');
    } finally {
      setBusy(false);
    }
  }

  async function closeShift() {
    setFormError('');
    let countedCents;
    try {
      countedCents = parseMoneyToCents(countedInput);
    } catch (parseError) {
      setFormError(parseError.message);
      return;
    }
    setBusy(true);
    try {
      await api.closeShift(current.shift.id, { countedCents, notes: closeNotes.trim() });
      setCurrent(null);
      setCloseModal(false);
      setCountedInput('');
      setCloseNotes('');
      window.dispatchEvent(new CustomEvent('restpos:shift-changed'));
      await load();
    } catch (shiftError) {
      setFormError(shiftError.message || 'No se pudo cerrar el turno.');
    } finally {
      setBusy(false);
    }
  }

  function openCloseModal() {
    setFormError('');
    setCloseNotes('');
    setCountedInput(centsToInput(current.totals.expectedCents));
    setCloseModal(true);
  }

  const expectedCents = current?.totals?.expectedCents ?? 0;
  let countedPreview;
  try {
    countedPreview = parseMoneyToCents(countedInput);
  } catch {
    countedPreview = null;
  }

  return (
    <div className="cash-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Operación</span>
          <h1>Caja y turnos</h1>
          <p>Controla el efectivo, los cobros y el cierre de tu turno.</p>
        </div>
        {current ? (
          <button type="button" className="btn btn-primary" onClick={openCloseModal} disabled={busy}>
            <Icon name="check" size={19} />
            Cerrar turno
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => { setOpenModal(true); setFormError(''); }} disabled={busy || !canOperate}>
            <Icon name="cash" size={19} />
            Abrir turno
          </button>
        )}
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={20} />
          <div><strong>No se pudo cargar la caja</strong><p>{error}</p></div>
          <button type="button" className="btn btn-small btn-secondary" onClick={() => void load()}>Reintentar</button>
        </div>
      ) : null}

      {loading && !current ? (
        <div className="cash-loading"><span className="spinner" aria-hidden="true" /> Cargando caja…</div>
      ) : current ? (
        <>
          <div className="shift-banner">
            <div className="shift-banner-main">
              <span className="shift-live"><span className="pulse-dot" /> Turno abierto</span>
              <h2>Abierto por {current.shift.openedByName}</h2>
              <p>
                {new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(current.shift.openedAt))} · desde {formatTime(current.shift.openedAt)}
              </p>
            </div>
            <div className="shift-banner-total">
              <span>Esperado en caja</span>
              <strong>{formatMoney(expectedCents)}</strong>
            </div>
          </div>

          <div className="summary-grid cash-summary">
            <div className="summary-card"><span className="summary-card-icon"><Icon name="cash" size={20} /></span><div><span>Fondo inicial</span><strong>{formatMoney(current.shift.openingCents)}</strong></div></div>
            <div className="summary-card"><span className="summary-card-icon"><Icon name="cash" size={20} /></span><div><span>Ventas en efectivo</span><strong>{formatMoney(current.totals.efectivo)}</strong></div></div>
            <div className="summary-card"><span className="summary-card-icon"><Icon name="card" size={20} /></span><div><span>Tarjeta</span><strong>{formatMoney(current.totals.tarjeta)}</strong></div></div>
            <div className="summary-card"><span className="summary-card-icon"><Icon name="wallet" size={20} /></span><div><span>Otros / propinas</span><strong>{formatMoney(current.totals.otro)}</strong><small>{formatMoney(current.totals.tipsCents)} en propinas</small></div></div>
          </div>

          <div className="panel cash-detail">
            <div className="panel-heading"><div><h2>Resumen del turno</h2><p>{current.totals.orderCount} pedidos · {current.totals.paymentCount} pagos</p></div></div>
            <div className="cash-breakdown">
              <div><span>Fondo inicial</span><strong>{formatMoney(current.shift.openingCents)}</strong></div>
              <div><span>Ventas en efectivo</span><strong>{formatMoney(current.totals.efectivo)}</strong></div>
              <div className="is-total"><span>Efectivo esperado</span><strong>{formatMoney(expectedCents)}</strong></div>
            </div>
            <p className="cash-hint"><Icon name="note" size={15} /> Al cerrar, captura el efectivo contado. La diferencia se registra para auditoría.</p>
          </div>
          <div className="panel cash-detail payment-breakdown-panel">
            <div className="panel-heading"><div><h2>Pagos del turno</h2><p>Desglose por método</p></div></div>
            {(current.totals.methods ?? []).length === 0 ? <p className="field-hint">Todavía no hay pagos en este turno.</p> : (
              <div className="payment-breakdown-list">
                {(current.totals.methods ?? []).map((method) => (
                  <div key={method.code} className="payment-breakdown-row">
                    <span className={`method-icon method-${method.kind}`}><Icon name={method.kind === 'cash' ? 'cash' : method.kind === 'card' ? 'card' : method.kind === 'transfer' ? 'phone' : 'wallet'} size={16} /></span>
                    <div><strong>{method.name}</strong><span>{method.paymentCount} pagos</span></div>
                    <strong>{formatMoney(method.totalCents)}</strong>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="empty-panel cash-empty">
          <span className="empty-icon"><Icon name="cash" size={30} /></span>
          <h3>No hay un turno abierto</h3>
          <p>Abre la caja para comenzar a cobrar y llevar el control de efectivo.</p>
          <button type="button" className="btn btn-primary" onClick={() => { setOpenModal(true); setFormError(''); }} disabled={busy || !canOperate}>
            <Icon name="cash" size={19} /> Abrir turno
          </button>
        </div>
      )}

      <section className="panel open-orders-panel" aria-labelledby="open-orders-title">
        <div className="panel-heading">
          <div><h2 id="open-orders-title">Cuentas abiertas</h2><p>Comer aquí, para llevar y delivery</p></div>
          <div className="service-legend"><span className="service-dot service-dine_in" /> Comer aquí <span className="service-dot service-takeaway" /> Para llevar <span className="service-dot service-delivery" /> Delivery</div>
        </div>
        {openOrders.length === 0 ? (
          <div className="open-orders-empty"><Icon name="receipt" size={22} /><span>No hay cuentas abiertas en este momento.</span></div>
        ) : (
          <div className="open-orders-list">
            {openOrders.map((order) => (
              <div key={order.id} className="open-order-row">
                <span className={`service-badge service-${order.serviceType}`}>{serviceLabel(order)}</span>
                <div className="open-order-main"><strong>{order.orderNumber}</strong><span>{order.customerName || (order.itemCount ? `${order.itemCount} artículos` : 'Sin artículos')}</span></div>
                <div className="open-order-money"><span>Total</span><strong>{formatMoney(order.totalCents)}</strong></div>
                <div className="open-order-money"><span>Saldo</span><strong className={order.balanceCents > 0 ? 'text-danger' : 'text-success'}>{formatMoney(order.balanceCents)}</strong></div>
                <a href={`/?order=${order.id}`} className="text-button">Cobrar en POS <Icon name="chevronRight" size={15} /></a>
              </div>
            ))}
          </div>
        )}
      </section>

      <KitchenQueue compact title="Cocina · platillos en curso" />

      {history.length > 0 ? (
        <section className="panel shift-history">
          <div className="panel-heading"><div><h2>Turnos recientes</h2><p>Historial de apertura y cierre de caja</p></div></div>
          <div className="sales-table-wrap">
            <table className="sales-table">
              <thead><tr><th>Apertura</th><th>Empleado</th><th>Pedidos</th><th>Efectivo esperado</th><th>Contado</th><th>Diferencia</th><th>Estado</th></tr></thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.shift.id}>
                    <td>{new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(entry.shift.openedAt))}<span className="table-subtext">{formatTime(entry.shift.openedAt)}</span></td>
                    <td>{entry.shift.openedByName}</td>
                    <td>{entry.totals.orderCount}</td>
                    <td>{formatMoney(entry.totals.expectedCents)}</td>
                    <td>{entry.shift.countedCents === null ? '—' : formatMoney(entry.shift.countedCents)}</td>
                    <td className={entry.shift.differenceCents ? (entry.shift.differenceCents < 0 ? 'text-danger' : 'text-success') : ''}>
                      {entry.shift.differenceCents === null ? '—' : formatMoney(entry.shift.differenceCents)}
                    </td>
                    <td><span className={`status-badge ${entry.shift.status === 'open' ? 'is-active' : 'is-inactive'}`}>{entry.shift.status === 'open' ? 'Abierto' : 'Cerrado'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <Modal
        open={openModal}
        onClose={() => setOpenModal(false)}
        title="Abrir turno de caja"
        subtitle="Captura el fondo inicial de efectivo."
        size="sm"
        closeDisabled={busy}
        footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button className="btn btn-secondary" onClick={() => setOpenModal(false)} disabled={busy}>Cancelar</button><button className="btn btn-primary" onClick={() => void openShift()} disabled={busy}>{busy ? <span className="spinner spinner-small" /> : <Icon name="cash" size={18} />} Abrir turno</button></div></div>}
      >
        <div className="form-grid">
          <label className="field field-full">
            <span className="field-label">Fondo inicial en efectivo</span>
            <div className="money-input-wrap"><span className="money-prefix">$</span><input className="input money-input" inputMode="decimal" value={openingInput} onChange={(event) => setOpeningInput(event.target.value)} /></div>
          </label>
          <label className="field field-full">
            <span className="field-label">Notas <small className="field-hint">opcional</small></span>
            <input className="input" value={openNotes} onChange={(event) => setOpenNotes(event.target.value)} placeholder="Ej. cambio para el turno" maxLength={300} />
          </label>
          {formError ? <p className="form-error field-full">{formError}</p> : null}
        </div>
      </Modal>

      <Modal
        open={closeModal}
        onClose={() => setCloseModal(false)}
        title="Cerrar turno"
        subtitle="Cuenta el efectivo físico en la caja."
        size="sm"
        closeDisabled={busy}
        footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button className="btn btn-secondary" onClick={() => setCloseModal(false)} disabled={busy}>Cancelar</button><button className="btn btn-primary" onClick={() => void closeShift()} disabled={busy}>{busy ? <span className="spinner spinner-small" /> : <Icon name="check" size={18} />} Confirmar cierre</button></div></div>}
      >
        <div className="close-cash-preview">
          <div><span>Esperado</span><strong>{formatMoney(expectedCents)}</strong></div>
          <div><span>Diferencia</span><strong className={countedPreview !== null ? (countedPreview - expectedCents < 0 ? 'text-danger' : countedPreview - expectedCents > 0 ? 'text-success' : '') : ''}>{countedPreview === null ? '—' : formatMoney(countedPreview - expectedCents)}</strong></div>
        </div>
        <div className="form-grid">
          <label className="field field-full">
            <span className="field-label">Efectivo contado</span>
            <div className="money-input-wrap money-input-large"><span className="money-prefix">$</span><input className="input money-input" inputMode="decimal" value={countedInput} onChange={(event) => setCountedInput(event.target.value)} autoFocus /></div>
          </label>
          <label className="field field-full">
            <span className="field-label">Notas <small className="field-hint">opcional</small></span>
            <input className="input" value={closeNotes} onChange={(event) => setCloseNotes(event.target.value)} placeholder="Observaciones del cierre" maxLength={300} />
          </label>
          {formError ? <p className="form-error field-full">{formError}</p> : null}
        </div>
      </Modal>
    </div>
  );
}
