'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { useFeatures } from '@/components/FeatureProvider';
import { formatTime, serviceLabel } from '@/lib/format';

const COLUMNS = [
  { status: 'sent', title: 'Nuevos', hint: 'Pedidos enviados', icon: 'receipt', action: 'Empezar', next: 'preparing' },
  { status: 'preparing', title: 'En preparación', hint: 'En la cocina', icon: 'chef', action: 'Marcar listo', next: 'ready' },
  { status: 'ready', title: 'Listos', hint: 'Para servir', icon: 'check', action: 'Servido', next: 'served' },
];

function elapsedLabel(iso, now) {
  if (!iso) return '';
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return 'Ahora';
  if (minutes === 1) return '1 min';
  return `${minutes} min`;
}

export default function KitchenPage() {
  const { enabled } = useFeatures();
  const [stations, setStations] = useState([]);
  const [stationId, setStationId] = useState('');
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyItem, setBusyItem] = useState(null);
  const [now, setNow] = useState(Date.now());
  const loadedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else if (!loadedRef.current) setLoading(true);
    try {
      const response = await api.getKitchenTickets(stationId || undefined);
      setTickets(response.tickets ?? []);
      setError('');
      loadedRef.current = true;
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar la cocina.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [stationId]);

  useEffect(() => {
    void load();
    const poll = setInterval(() => void load(true), 5000);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  useEffect(() => {
    if (!enabled('kitchen_stations')) return;
    api.getKitchenStations().then((response) => setStations(response.stations ?? [])).catch(() => setStations([]));
  }, [enabled]);

  const itemsByStatus = useMemo(() => {
    const groups = { sent: [], preparing: [], ready: [] };
    for (const ticket of tickets) {
      for (const item of ticket.items) {
        if (groups[item.status]) {
          groups[item.status].push({ ...item, ticket });
        }
      }
    }
    return groups;
  }, [tickets]);

  async function advance(item, nextStatus) {
    setBusyItem(item.id);
    setError('');
    try {
      await api.updateKitchenItem(item.id, nextStatus);
      window.dispatchEvent(new CustomEvent('restpos:kitchen-changed'));
      await load(true);
    } catch (updateError) {
      setError(updateError.message || 'No se pudo actualizar el platillo.');
    } finally {
      setBusyItem(null);
    }
  }

  const activeCount = Object.values(itemsByStatus).reduce((sum, items) => sum + items.length, 0);

  return (
    <div className="kitchen-page">
      <div className="kitchen-topbar">
        <div>
          <span className="eyebrow">Cocina en vivo</span>
          <h1>Comandas</h1>
          <p>{activeCount} {activeCount === 1 ? 'platillo activo' : 'platillos activos'} · se actualiza automáticamente</p>
        </div>
        <div className="kitchen-actions">
          <span className={`live-indicator ${refreshing ? 'is-syncing' : ''}`}><span /> {refreshing ? 'Sincronizando' : 'En vivo'}</span>
          <button type="button" className="btn btn-secondary" onClick={() => void load(true)} disabled={refreshing}>
            <Icon name="refresh" size={18} className={refreshing ? 'spin' : ''} /> Actualizar
          </button>
        </div>
      </div>

      {enabled('kitchen_stations') && stations.length > 0 ? (
        <div className="category-strip kitchen-station-strip" role="tablist" aria-label="Estaciones de cocina">
          <button type="button" role="tab" aria-selected={!stationId} className={`category-chip ${!stationId ? 'is-active' : ''}`} onClick={() => setStationId('')}>Todas <span>{tickets.length}</span></button>
          {stations.map((station) => (
            <button key={station.id} type="button" role="tab" aria-selected={stationId === String(station.id)} className={`category-chip ${stationId === String(station.id) ? 'is-active' : ''}`} onClick={() => setStationId(String(station.id))}>
              <span className="station-dot" style={{ background: station.color }} /> {station.name}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="alert alert-error">
          <Icon name="alert" size={19} />
          <p>{error}</p>
          <button type="button" className="btn btn-small btn-secondary" onClick={() => void load(true)}>Reintentar</button>
        </div>
      ) : null}

      {loading && tickets.length === 0 ? (
        <div className="app-loading"><span className="spinner" /> Cargando comandas…</div>
      ) : (
        <div className="kds-board">
          {COLUMNS.map((column) => {
            const items = itemsByStatus[column.status] ?? [];
            return (
              <section key={column.status} className={`kds-column kds-${column.status}`}>
                <header className="kds-column-head">
                  <div className="kds-column-title">
                    <span className={`kds-icon kds-icon-${column.status}`}><Icon name={column.icon} size={19} /></span>
                    <div><h2>{column.title}</h2><span>{column.hint}</span></div>
                  </div>
                  <span className="kds-count">{items.length}</span>
                </header>
                <div className="kds-column-body">
                  {items.length === 0 ? (
                    <div className="kds-empty"><Icon name={column.status === 'ready' ? 'check' : 'chef'} size={28} /><p>Sin platillos</p></div>
                  ) : (
                    items.map((item) => (
                      <article key={`${item.ticket.orderId}-${item.id}`} className="kds-card">
                        <div className="kds-card-top">
                          <span className="kds-order">{item.ticket.orderNumber}</span>
                          <span className={`service-badge service-${item.ticket.serviceType}`}>
                            {serviceLabel(item.ticket)}
                          </span>
                          <span className="kds-time">{elapsedLabel(item.sentAt, now)}</span>
                          {item.targetAt ? <span className={`kds-target ${new Date(item.targetAt).getTime() < now ? 'is-late' : ''}`}>{new Date(item.targetAt).getTime() < now ? 'Tarde' : 'Meta ' + formatTime(item.targetAt)}</span> : null}
                        </div>
                        <div className="kds-item-line">
                          <span className="kds-qty">{item.quantity}</span>
                          <div>
                            <h3>{item.productName}</h3>
                            {item.modifiers.length > 0 ? <p className="kds-modifiers">{item.modifiers.map((m) => m.name).join(' · ')}</p> : null}
                            {item.notes ? <p className="kds-note"><Icon name="note" size={13} /> {item.notes}</p> : null}
                          </div>
                        </div>
                        {item.ticket.customerName && item.status === 'sent' ? <span className="kds-customer">{item.ticket.customerName}</span> : null}
                        <button type="button" className={`btn kds-action kds-action-${column.status}`} onClick={() => void advance(item, column.next)} disabled={busyItem === item.id}>
                          {busyItem === item.id ? <span className="spinner spinner-small" /> : <Icon name={column.status === 'ready' ? 'check' : 'chevronRight'} size={18} />}
                          {column.action}
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {!loading && activeCount === 0 && tickets.length === 0 ? (
        <div className="kds-all-clear">
          <span className="success-check"><Icon name="check" size={34} /></span>
          <h2>Todo al día</h2>
          <p>No hay comandas pendientes. Las nuevas aparecerán aquí automáticamente.</p>
        </div>
      ) : null}
    </div>
  );
}
