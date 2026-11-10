'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import {
  formatBusinessDate,
  formatMoney,
  formatTime,
  paymentLabel,
  pluralize,
} from '@/lib/format';

const PAGE_SIZE = 20;

function SummaryCard({ label, value, hint, icon, accent = false }) {
  return (
    <div className={`summary-card ${accent ? 'is-accent' : ''}`}>
      <span className="summary-card-icon">
        <Icon name={icon} size={21} />
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="history-skeleton" aria-hidden="true">
      <div className="summary-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="summary-card skeleton-card">
            <div className="skeleton-line short" />
            <div className="skeleton-line title" />
          </div>
        ))}
      </div>
      <div className="history-columns">
        <div className="panel skeleton-card">
          <div className="skeleton-line medium" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
        <div className="panel skeleton-card">
          <div className="skeleton-line medium" />
          <div className="skeleton-line" />
          <div className="skeleton-line" />
        </div>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const [report, setReport] = useState(null);
  const [orders, setOrders] = useState([]);
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const loadDay = useCallback(async (requestedDate) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const reportData = await api.getDailyReport(requestedDate || undefined);
      if (requestRef.current !== requestId) return;
      setReport(reportData);
      setDate(reportData.date);
      const ordersData = await api.getOrders({
        status: 'pagada',
        date: reportData.date,
        limit: PAGE_SIZE,
        offset: 0,
      });
      if (requestRef.current !== requestId) return;
      setOrders(ordersData.orders);
    } catch (loadError) {
      if (requestRef.current !== requestId) return;
      setError(loadError?.message || 'No se pudo cargar el historial.');
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  async function loadMore() {
    if (!report || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await api.getOrders({
        status: 'pagada',
        date: report.date,
        limit: PAGE_SIZE,
        offset: orders.length,
      });
      setOrders((previous) => [...previous, ...response.orders]);
    } catch (loadError) {
      setError(loadError?.message || 'No se pudieron cargar más ventas.');
    } finally {
      setLoadingMore(false);
    }
  }

  const topQuantity = report?.topProducts?.[0]?.quantity ?? 0;

  return (
    <div className="history-page">
      <div className="page-heading history-heading">
        <div>
          <span className="eyebrow">Cierre de caja</span>
          <h1>Historial y resumen del día</h1>
          <p>Consulta las ventas cobradas, los métodos de pago y los productos más vendidos.</p>
        </div>
        <div className="heading-actions">
          <label className="date-field">
            <span>Fecha</span>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(event) => {
                const value = event.target.value;
                if (!value) return;
                setDate(value);
                void loadDay(value);
              }}
              aria-label="Fecha del reporte"
              lang="es-MX"
            />
          </label>
          <a className="btn btn-secondary" href={api.getDailyReportCsvUrl(date || report?.date)} download>
            <Icon name="download" size={19} />
            Exportar CSV
          </a>
          <button type="button" className="btn btn-secondary" onClick={() => void loadDay(date)} disabled={loading}>
            <Icon name="refresh" size={19} className={loading ? 'spin' : ''} />
            Actualizar
          </button>
        </div>
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <strong>No se pudo cargar la información</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="btn btn-small btn-secondary" onClick={() => void loadDay(date)}>
            Reintentar
          </button>
        </div>
      ) : null}

      {loading && !report ? (
        <HistorySkeleton />
      ) : report ? (
        <>
          <div className="report-period">
            <span>{formatBusinessDate(report.date)}</span>
            <span>
              Zona horaria: {report.timezone} · Moneda: {report.currency}
            </span>
          </div>

          <section className="summary-grid" aria-label="Resumen de ventas">
            <SummaryCard
              label="Ventas del día"
              value={formatMoney(report.salesCents)}
              hint="Sin propinas"
              icon="receipt"
              accent
            />
            <SummaryCard
              label="Cobrado en total"
              value={formatMoney(report.totalCollectedCents)}
              hint={`Incluye ${formatMoney(report.tipCents)} de propinas`}
              icon="cash"
            />
            <SummaryCard
              label="Pedidos cobrados"
              value={String(report.orderCount)}
              hint={pluralize(report.orderCount, 'ticket', 'tickets')}
              icon="bag"
            />
            <SummaryCard
              label="Ticket promedio"
              value={formatMoney(report.averageTicketCents)}
              hint="Cobrado / pedidos"
              icon="pos"
            />
          </section>

          <div className="history-columns">
            <section className="panel" aria-labelledby="top-products-title">
              <div className="panel-heading">
                <div>
                  <h2 id="top-products-title">Productos más vendidos</h2>
                  <p>Por cantidad de unidades cobradas</p>
                </div>
                <span className="panel-badge">{report.topProducts.length}</span>
              </div>
              {report.topProducts.length === 0 ? (
                <div className="empty-panel">
                  <Icon name="tag" size={28} />
                  <p>No hay productos vendidos en esta fecha.</p>
                </div>
              ) : (
                <ol className="product-ranking">
                  {report.topProducts.map((product, index) => (
                    <li key={product.productName}>
                      <span className="rank-number">{index + 1}</span>
                      <div className="rank-info">
                        <div>
                          <strong>{product.productName}</strong>
                          <span>{formatMoney(product.revenueCents)}</span>
                        </div>
                        <div className="rank-bar">
                          <span
                            style={{
                              width: `${Math.max(6, Math.round((product.quantity / topQuantity) * 100))}%`,
                            }}
                          />
                        </div>
                      </div>
                      <span className="rank-quantity">
                        {product.quantity}
                        <small>{pluralize(product.quantity, 'ud.', 'uds.')}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="panel" aria-labelledby="payments-title">
              <div className="panel-heading">
                <div>
                  <h2 id="payments-title">Métodos de pago</h2>
                  <p>Total cobrado por método</p>
                </div>
              </div>
              <div className="payment-breakdown">
                {Object.entries(report.payments).map(([method, data]) => {
                  const icons = { efectivo: 'cash', tarjeta: 'card', otro: 'wallet' };
                  return (
                    <div key={method} className="payment-breakdown-row">
                      <span className={`payment-breakdown-icon method-${method}`}>
                        <Icon name={icons[method] ?? 'wallet'} size={20} />
                      </span>
                      <div>
                        <strong>{paymentLabel(method)}</strong>
                        <span>
                          {data.orderCount} {pluralize(data.orderCount, 'pedido', 'pedidos')}
                        </span>
                      </div>
                      <strong>{formatMoney(data.totalCents)}</strong>
                    </div>
                  );
                })}
              </div>
              <div className="mini-summary">
                <div>
                  <span>Subtotal</span>
                  <strong>{formatMoney(report.subtotalCents)}</strong>
                </div>
                <div>
                  <span>Descuentos</span>
                  <strong>-{formatMoney(report.discountCents)}</strong>
                </div>
                <div>
                  <span>Impuestos</span>
                  <strong>{formatMoney(report.taxCents)}</strong>
                </div>
                <div>
                  <span>Propinas</span>
                  <strong>{formatMoney(report.tipCents)}</strong>
                </div>
              </div>
            </section>
          </div>

          <div className="history-columns">
            <section className="panel" aria-labelledby="staff-report-title">
              <div className="panel-heading"><div><h2 id="staff-report-title">Ventas por empleado</h2><p>Rendimiento del turno</p></div></div>
              {report.staff.length === 0 ? <div className="empty-panel"><Icon name="users" size={28} /><p>Sin ventas registradas.</p></div> : (
                <div className="staff-report-list">
                  {report.staff.map((person) => (
                    <div key={person.staffId ?? 'none'} className="staff-report-row">
                      <span className="avatar avatar-small">{person.staffName.slice(0, 2).toUpperCase()}</span>
                      <div><strong>{person.staffName}</strong><span>{person.orderCount} pedidos</span></div>
                      <div className="staff-report-figures"><strong>{formatMoney(person.salesCents)}</strong><span>{formatMoney(person.tipCents)} propinas</span></div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="panel" aria-labelledby="categories-report-title">
              <div className="panel-heading"><div><h2 id="categories-report-title">Ventas por categoría</h2><p>Mezcla del menú</p></div></div>
              {report.categories.length === 0 ? <div className="empty-panel"><Icon name="tag" size={28} /><p>Sin ventas registradas.</p></div> : (
                <div className="category-report-list">
                  {report.categories.map((category) => {
                    const max = report.categories[0]?.revenueCents || 1;
                    return (
                      <div key={category.name} className="category-report-row">
                        <div><strong>{category.name}</strong><span>{category.quantity} uds.</span><strong>{formatMoney(category.revenueCents)}</strong></div>
                        <div className="rank-bar"><span style={{ width: `${Math.max(5, Math.round((category.revenueCents / max) * 100))}%` }} /></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="panel hourly-panel" aria-labelledby="hourly-title">
            <div className="panel-heading"><div><h2 id="hourly-title">Ventas por hora</h2><p>Identifica las horas de mayor demanda</p></div><span className="panel-badge">Hoy</span></div>
            <div className="hourly-chart">
              {(() => {
                const max = Math.max(...report.hours.map((hour) => hour.salesCents), 1);
                return report.hours.filter((hour) => hour.orderCount > 0 || (Number(hour.hour) >= 8 && Number(hour.hour) <= 23)).map((hour) => (
                  <div key={hour.hour} className={`hourly-bar-wrap ${hour.orderCount ? 'has-sales' : ''}`}>
                    <span className="hourly-value">{hour.salesCents > 0 ? formatMoney(hour.salesCents) : ''}</span>
                    <div className="hourly-bar" style={{ height: `${Math.max(3, Math.round((hour.salesCents / max) * 100))}%` }} title={`${hour.orderCount} pedidos`} />
                    <span className="hourly-label">{String(hour.hour).padStart(2, '0')}</span>
                  </div>
                ));
              })()}
            </div>
          </section>

          <section className="panel sales-panel" aria-labelledby="sales-title">
            <div className="panel-heading">
              <div>
                <h2 id="sales-title">Tickets del día</h2>
                <p>{report.orderCount} {pluralize(report.orderCount, 'venta cobrada', 'ventas cobradas')}</p>
              </div>
              <span className="panel-badge">{orders.length} / {report.orderCount}</span>
            </div>

            {loading ? (
              <div className="loading-row">
                <span className="spinner" aria-hidden="true" />
                Actualizando…
              </div>
            ) : orders.length === 0 ? (
              <div className="empty-panel">
                <Icon name="receipt" size={30} />
                <h3>Sin ventas en esta fecha</h3>
                <p>Los tickets aparecerán aquí en cuanto se cobre un pedido.</p>
              </div>
            ) : (
              <div className="sales-table-wrap">
                <table className="sales-table">
                  <thead>
                    <tr>
                      <th scope="col">Hora</th>
                      <th scope="col">Ticket</th>
                      <th scope="col">Origen</th>
                      <th scope="col">Artículos</th>
                      <th scope="col">Pago</th>
                      <th scope="col" className="align-right">Total</th>
                      <th scope="col"><span className="sr-only">Acciones</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id}>
                        <td>{formatTime(order.paidAt, report.timezone)}</td>
                        <td>
                          <strong>{order.orderNumber}</strong>
                          {order.customerName ? <span className="table-subtext">{order.customerName}</span> : null}
                        </td>
                        <td>{order.type === 'mesa' ? order.tableName : 'Para llevar'}</td>
                        <td>{order.itemCount}</td>
                        <td>
                          <span className={`method-pill method-${order.paymentMethod}`}>
                            {paymentLabel(order.paymentMethod)}
                          </span>
                        </td>
                        <td className="align-right amount-cell">{formatMoney(order.totalCents)}</td>
                        <td className="align-right">
                          <a
                            className="icon-button table-link"
                            href={`/recibo/${order.id}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Ver ticket ${order.orderNumber}`}
                          >
                            <Icon name="receipt" size={18} />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {orders.length < report.orderCount ? (
              <div className="load-more-row">
                <button type="button" className="btn btn-secondary" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? <span className="spinner spinner-small" aria-hidden="true" /> : <Icon name="chevronRight" size={18} />}
                  Cargar más tickets
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <div className="empty-panel">
          <Icon name="history" size={32} />
          <h3>No hay información disponible</h3>
          <button type="button" className="btn btn-primary" onClick={() => void loadDay(date)}>
            Reintentar
          </button>
        </div>
      )}
    </div>
  );
}
