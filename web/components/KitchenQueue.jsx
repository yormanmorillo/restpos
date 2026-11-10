'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { formatMoney, serviceLabel, serviceShortLabel } from '@/lib/format';

const NEXT_ACTION = {
  sent: { status: 'preparing', label: 'Preparando', icon: 'chef' },
  preparing: { status: 'ready', label: 'Listo', icon: 'check' },
  ready: { status: 'served', label: 'Servido', icon: 'check' },
};

function minutesSince(iso, now) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
}

export default function KitchenQueue({ compact = false, onOpenOrder = null, title = 'Órdenes en cocina' }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.getKitchenTickets();
      setTickets(response.tickets ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudo consultar la cocina.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(true), 7000);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    const onChange = () => void load(true);
    window.addEventListener('restpos:kitchen-changed', onChange);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      window.removeEventListener('restpos:kitchen-changed', onChange);
    };
  }, [load]);

  const itemCount = useMemo(
    () => tickets.reduce((sum, ticket) => sum + ticket.items.length, 0),
    [tickets],
  );

  async function advanceItem(item, ticket) {
    const action = NEXT_ACTION[item.status];
    if (!action) return;
    setBusy(`item-${item.id}`);
    setError('');
    try {
      await api.updateKitchenItem(item.id, action.status);
      await load(true);
      window.dispatchEvent(new CustomEvent('restpos:kitchen-changed'));
    } catch (updateError) {
      setError(updateError.message || 'No se pudo cambiar el estado.');
    } finally {
      setBusy('');
    }
  }

  async function advanceTicket(ticket, status) {
    setBusy(`ticket-${ticket.orderId}`);
    setError('');
    try {
      await api.updateKitchenTicket(ticket.orderId, status);
      await load(true);
      window.dispatchEvent(new CustomEvent('restpos:kitchen-changed'));
    } catch (updateError) {
      setError(updateError.message || 'No se pudo cambiar el estado del pedido.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={`kitchen-queue panel ${compact ? 'is-compact' : ''}`} aria-labelledby="kitchen-queue-title">
      <div className="panel-heading kitchen-queue-heading">
        <div>
          <h2 id="kitchen-queue-title">{title}</h2>
          <p>{tickets.length} {tickets.length === 1 ? 'pedido' : 'pedidos'} · {itemCount} {itemCount === 1 ? 'platillo' : 'platillos'}</p>
        </div>
        <span className="live-indicator"><span /> En vivo</span>
      </div>

      {error ? (
        <div className="inline-error"><Icon name="alert" size={16} /> {error}<button type="button" className="text-button" onClick={() => void load()}>Reintentar</button></div>
      ) : null}

      {loading && tickets.length === 0 ? (
        <div className="kitchen-queue-empty"><span className="spinner spinner-small" /> Consultando cocina…</div>
      ) : tickets.length === 0 ? (
        <div className="kitchen-queue-empty">
          <span className="queue-empty-icon"><Icon name="chef" size={23} /></span>
          <div><strong>No hay platillos en cocina</strong><span>Los pedidos enviados aparecerán aquí.</span></div>
        </div>
      ) : (
        <div className="kitchen-queue-list">
          {tickets.map((ticket) => {
            const hasSent = ticket.items.some((item) => item.status === 'sent');
            const hasPreparing = ticket.items.some((item) => ['sent', 'preparing'].includes(item.status));
            const hasReady = ticket.items.some((item) => ['sent', 'preparing', 'ready'].includes(item.status));
            const minutes = minutesSince(ticket.sentAt, now);
            return (
              <article key={ticket.orderId} className="kitchen-ticket">
                <div className="kitchen-ticket-head">
                  <div>
                    <div className="kitchen-ticket-title">
                      <strong>{ticket.orderNumber}</strong>
                      <span className={`service-badge service-${ticket.serviceType}`}>{serviceShortLabel(ticket)}</span>
                      {ticket.serviceType === 'dine_in' && ticket.tableName ? <span className="kitchen-table">{ticket.tableName}</span> : null}
                    </div>
                    <p>
                      {ticket.customerName ? `${ticket.customerName} · ` : ''}
                      {minutes === 0 ? 'Ahora' : `${minutes} min`}
                      {!compact ? ` · ${formatMoney(ticket.totalCents)}` : ''}
                    </p>
                  </div>
                  {onOpenOrder ? (
                    <button type="button" className="text-button kitchen-open" onClick={() => onOpenOrder(ticket.orderId)}>
                      Abrir cuenta <Icon name="chevronRight" size={15} />
                    </button>
                  ) : null}
                </div>

                <div className="kitchen-ticket-items">
                  {ticket.items.map((item) => {
                    const next = NEXT_ACTION[item.status];
                    return (
                      <div key={item.id} className={`kitchen-line status-${item.status}`}>
                        <span className="kitchen-line-qty">{item.quantity}</span>
                        <div>
                          <strong>{item.productName}</strong>
                          {item.modifiers.length > 0 ? <small>{item.modifiers.map((modifier) => modifier.name).join(' · ')}</small> : null}
                          {item.notes ? <small className="kitchen-line-note">{item.notes}</small> : null}
                        </div>
                        <span className={`item-status is-${item.status}`}>{item.status === 'sent' ? 'Enviado' : item.status === 'preparing' ? 'Preparando' : item.status === 'ready' ? 'Listo' : 'Servido'}</span>
                        {next ? (
                          <button
                            type="button"
                            className={`btn btn-small kitchen-line-action ${item.status === 'preparing' ? 'is-ready' : ''}`}
                            onClick={() => void advanceItem(item, ticket)}
                            disabled={busy === `item-${item.id}`}
                          >
                            {busy === `item-${item.id}` ? <span className="spinner spinner-tiny" /> : null}
                            {next.label}
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="kitchen-ticket-actions">
                  {hasSent ? (
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => void advanceTicket(ticket, 'preparing')} disabled={busy === `ticket-${ticket.orderId}`}>
                      Todo preparando
                    </button>
                  ) : null}
                  {hasPreparing ? (
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => void advanceTicket(ticket, 'ready')} disabled={busy === `ticket-${ticket.orderId}`}>
                      Todo listo
                    </button>
                  ) : null}
                  {hasReady ? (
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => void advanceTicket(ticket, 'served')} disabled={busy === `ticket-${ticket.orderId}`}>
                      Servido
                    </button>
                  ) : null}
                  <span className="kitchen-service-label">{serviceLabel(ticket)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
