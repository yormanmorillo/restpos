'use client';

import Icon from '@/components/Icon';
import { formatMoney, formatTime, pluralize } from '@/lib/format';

function TableCard({ table, onOpen, disabled, timeZone }) {
  const occupied = table.status === 'ocupada';
  return (
    <button
      type="button"
      className={`table-card ${occupied ? 'is-occupied' : 'is-free'}`}
      onClick={() => onOpen(table)}
      disabled={disabled}
      aria-label={
        occupied
          ? `${table.name}, ocupada, total ${formatMoney(table.openOrder.totalCents)}. Abrir pedido.`
          : `${table.name}, libre, ${table.capacity} personas. Abrir mesa.`
      }
    >
      <div className="table-card-top">
        <span className={`status-dot ${occupied ? 'busy' : 'free'}`} aria-hidden="true" />
        <span className="table-status-label">{occupied ? 'Ocupada' : 'Libre'}</span>
        <span className="table-capacity">
          <Icon name="users" size={15} />
          {table.capacity}
        </span>
      </div>
      <div className="table-card-main">
        <span className="table-name">{table.name}</span>
        {occupied ? (
          <>
            <span className="table-total">{formatMoney(table.openOrder.totalCents)}</span>
            <span className="table-detail">
              {table.openOrder.orderNumber} · {table.openOrder.itemCount}{' '}
              {pluralize(table.openOrder.itemCount, 'artículo', 'artículos')} ·{' '}
              {formatTime(table.openOrder.openedAt, timeZone)}
            </span>
          </>
        ) : (
          <span className="table-detail">Toca para comenzar un pedido</span>
        )}
      </div>
      <div className="table-card-footer">
        <span>{occupied ? 'Abrir pedido' : 'Abrir mesa'}</span>
        <Icon name="chevronRight" size={18} />
      </div>
    </button>
  );
}

function TableSkeleton() {
  return (
    <div className="table-card skeleton-card" aria-hidden="true">
      <div className="skeleton-line short" />
      <div className="skeleton-line title" />
      <div className="skeleton-line" />
      <div className="skeleton-line medium" />
    </div>
  );
}

export default function HomeView({
  tables,
  takeawayOrders,
  loading,
  error,
  refreshing,
  busyLabel,
  onRetry,
  onOpenTable,
  onNewTakeaway,
  onOpenTakeaway,
  timeZone,
}) {
  const freeCount = tables.filter((table) => table.status === 'libre').length;
  const occupiedCount = tables.length - freeCount;

  return (
    <div className="home-view">
      <div className="page-heading home-heading">
        <div>
          <span className="eyebrow">Servicio de piso</span>
          <h1>Mesas y pedidos</h1>
          <p>Selecciona una mesa o abre un pedido para llevar. Todo se guarda automáticamente.</p>
        </div>
        <button type="button" className="btn btn-primary btn-takeaway" onClick={onNewTakeaway} disabled={Boolean(busyLabel)}>
          <Icon name="bag" size={22} />
          Nuevo para llevar
        </button>
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <strong>No se pudo cargar el salón</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="btn btn-small btn-secondary" onClick={onRetry} disabled={refreshing}>
            <Icon name="refresh" size={17} />
            Reintentar
          </button>
        </div>
      ) : null}

      <div className="quick-stats" aria-label="Resumen del salón">
        <span className="stat-pill">
          <span className="status-dot free" aria-hidden="true" />
          <strong>{freeCount}</strong> {pluralize(freeCount, 'mesa libre', 'mesas libres')}
        </span>
        <span className="stat-pill">
          <span className="status-dot busy" aria-hidden="true" />
          <strong>{occupiedCount}</strong> {pluralize(occupiedCount, 'mesa ocupada', 'mesas ocupadas')}
        </span>
        <button type="button" className="stat-pill stat-refresh" onClick={onRetry} disabled={refreshing || loading}>
          <Icon name="refresh" size={16} className={refreshing ? 'spin' : ''} />
          Actualizar
        </button>
      </div>

      <section className="tables-section" aria-labelledby="tables-title">
        <div className="section-heading">
          <h2 id="tables-title">Salón</h2>
          <span className="section-hint">Toca una mesa para abrir su cuenta</span>
        </div>
        <div className="tables-grid">
          {loading
            ? Array.from({ length: 8 }, (_, index) => <TableSkeleton key={index} />)
            : tables.map((table) => (
                <TableCard
                  key={table.id}
                  table={table}
                  timeZone={timeZone}
                  onOpen={onOpenTable}
                  disabled={Boolean(busyLabel)}
                />
              ))}
        </div>
      </section>

      <section className="takeaway-section" aria-labelledby="takeaway-title">
        <div className="section-heading">
          <h2 id="takeaway-title">Pedidos para llevar</h2>
          <span className="section-hint">{takeawayOrders.length} {takeawayOrders.length === 1 ? 'abierto' : 'abiertos'}</span>
        </div>
        {takeawayOrders.length === 0 ? (
          <div className="empty-inline">
            <Icon name="bag" size={22} />
            <p>No hay pedidos para llevar abiertos. Usa “Nuevo para llevar” para iniciar uno.</p>
          </div>
        ) : (
          <div className="takeaway-grid">
            {takeawayOrders.map((order) => (
              <button
                key={order.id}
                type="button"
                className="takeaway-card"
                onClick={() => onOpenTakeaway(order)}
                disabled={Boolean(busyLabel)}
              >
                <span className="takeaway-icon">
                  <Icon name="bag" size={22} />
                </span>
                <span className="takeaway-copy">
                  <strong>{order.customerName || 'Cliente sin nombre'}</strong>
                  <span>
                    {order.orderNumber} · {order.itemCount}{' '}
                    {pluralize(order.itemCount, 'artículo', 'artículos')}
                  </span>
                </span>
                <span className="takeaway-meta">
                  <strong>{formatMoney(order.totalCents)}</strong>
                  <span>{formatTime(order.createdAt, timeZone)}</span>
                </span>
                <Icon name="chevronRight" size={18} />
              </button>
            ))}
          </div>
        )}
      </section>

      {busyLabel ? (
        <div className="busy-overlay" role="status" aria-live="polite">
          <div className="busy-card">
            <span className="spinner" aria-hidden="true" />
            <strong>{busyLabel}</strong>
            <span>Un momento…</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
