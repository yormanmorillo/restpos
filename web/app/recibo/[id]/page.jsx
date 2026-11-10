'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import {
  formatBusinessDate,
  formatMoney,
  formatTime,
  paymentLabel,
} from '@/lib/format';

export default function ReceiptPage() {
  const params = useParams();
  const id = params?.id;
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeZone, setTimeZone] = useState(null);

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [response, health] = await Promise.all([
          api.getOrder(id),
          api.getHealth().catch(() => null),
        ]);
        if (cancelled) return;
        setOrder(response.order);
        setTimeZone(health?.timezone ?? null);
        document.title = `Ticket ${response.order.orderNumber} · Casa Roble`;
        setError('');
      } catch (loadError) {
        if (!cancelled) setError(loadError?.message || 'No se pudo cargar el ticket.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!order) return undefined;
    const shouldPrint = new URLSearchParams(window.location.search).get('print') === '1';
    if (!shouldPrint) return undefined;
    const timer = setTimeout(() => window.print(), 450);
    return () => clearTimeout(timer);
  }, [order]);

  if (loading) {
    return (
      <div className="receipt-page receipt-state">
        <span className="spinner" aria-hidden="true" />
        <p>Cargando ticket…</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="receipt-page receipt-state">
        <Icon name="alert" size={32} />
        <h1>No se pudo abrir el ticket</h1>
        <p>{error}</p>
        <Link href="/historial" className="btn btn-primary">Ir al historial</Link>
      </div>
    );
  }

  const paid = order.status === 'pagada';
  const paidTime = order.paidAt || order.updatedAt || order.createdAt;

  return (
    <div className="receipt-page">
      <div className="receipt-toolbar no-print">
        <Link href="/historial" className="btn btn-secondary">
          <Icon name="arrowLeft" size={18} />
          Historial
        </Link>
        <div className="receipt-toolbar-actions">
          <button type="button" className="btn btn-secondary" onClick={() => window.close()}>
            Cerrar
          </button>
          <button type="button" className="btn btn-secondary" onClick={async () => {
            try { await api.printOrder(order.id, 'receipt'); } catch (printError) { alert(printError.message); }
          }}>
            <Icon name="receipt" size={19} />
            Térmica
          </button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            <Icon name="printer" size={19} />
            Imprimir
          </button>
        </div>
      </div>

      <article className="receipt-paper" aria-label={`Ticket ${order.orderNumber}`}>
        <header className="receipt-header">
          <span className="receipt-leaf"><Icon name="leaf" size={26} /></span>
          <h1>Casa Roble</h1>
          <p>Cocina de la casa</p>
          <span>Av. Reforma 123 · Centro · CDMX</span>
          <span>Tel. 55 1234 5678</span>
        </header>

        <div className="receipt-rule" />

        <section className="receipt-meta">
          <div>
            <span>Ticket</span>
            <strong>{order.orderNumber}</strong>
          </div>
          <div>
            <span>Fecha</span>
            <strong>{formatBusinessDate(order.businessDate)}</strong>
          </div>
          <div>
            <span>Hora</span>
            <strong>{formatTime(paidTime, timeZone)}</strong>
          </div>
          <div>
            <span>Servicio</span>
            <strong>{order.type === 'mesa' ? order.tableName : 'Para llevar'}</strong>
          </div>
          {order.customerName ? (
            <div className="receipt-meta-wide">
              <span>Cliente</span>
              <strong>{order.customerName}</strong>
            </div>
          ) : null}
          {order.customerPhone ? (
            <div className="receipt-meta-wide">
              <span>Teléfono</span>
              <strong>{order.customerPhone}</strong>
            </div>
          ) : null}
          {order.delivery && order.deliveryAddress ? (
            <div className="receipt-meta-wide">
              <span>Dirección de entrega</span>
              <strong>{order.deliveryAddress}</strong>
            </div>
          ) : null}
        </section>

        {!paid ? (
          <div className="receipt-unpaid">
            {order.status === 'anulada'
              ? 'PEDIDO ANULADO · NO ES COMPROBANTE DE PAGO'
              : 'PEDIDO ABIERTO · NO ES COMPROBANTE DE PAGO'}
          </div>
        ) : null}

        <div className="receipt-rule" />

        <section className="receipt-items">
          <div className="receipt-items-head">
            <span>Cant.</span>
            <span>Producto</span>
            <span>Importe</span>
          </div>
          {order.items.map((item) => (
            <div key={item.clientKey} className="receipt-item">
              <span className="receipt-qty">{item.quantity}</span>
              <div className="receipt-item-name">
                <strong>{item.productName}</strong>
                <span>{formatMoney(item.unitPriceCents)} c/u</span>
                {(item.modifiers ?? []).map((modifier) => (
                  <em key={modifier.id}>+ {modifier.modifierName}{modifier.priceDeltaCents > 0 ? ` (${formatMoney(modifier.priceDeltaCents)})` : ''}</em>
                ))}
                {item.notes ? <em>{item.notes}</em> : null}
              </div>
              <span className="receipt-amount">{formatMoney(item.lineTotalCents)}</span>
            </div>
          ))}
        </section>

        <div className="receipt-rule" />

        <section className="receipt-totals">
          <div>
            <span>Subtotal</span>
            <span>{formatMoney(order.subtotalCents)}</span>
          </div>
          {order.discountCents > 0 ? (
            <div>
              <span>
                Descuento
                {order.discountType === 'percent' ? ` (${order.discountValue / 100}%)` : ''}
              </span>
              <span>-{formatMoney(order.discountCents)}</span>
            </div>
          ) : null}
          <div>
            <span>Impuesto ({order.taxRateBps / 100}%)</span>
            <span>{formatMoney(order.taxCents)}</span>
          </div>
          {order.deliveryFeeCents > 0 ? (
            <div>
              <span>Costo de entrega</span>
              <span>{formatMoney(order.deliveryFeeCents)}</span>
            </div>
          ) : null}
          {order.tipCents > 0 ? (
            <div>
              <span>Propina</span>
              <span>{formatMoney(order.tipCents)}</span>
            </div>
          ) : null}
          <div className="receipt-total">
            <span>Total</span>
            <strong>{formatMoney(order.totalCents)}</strong>
          </div>
        </section>

        <div className="receipt-rule" />

        <section className="receipt-payment">
          {paid ? (
            <>
              {(order.payments ?? []).length > 0 ? (
                (order.payments ?? []).map((payment) => (
                  <div key={payment.id}>
                    <span>{paymentLabel(payment.paymentMethod)}</span>
                    <span>{formatMoney(payment.amountCents)}</span>
                  </div>
                ))
              ) : (
                <div>
                  <span>Forma de pago</span>
                  <strong>{paymentLabel(order.paymentMethod)}</strong>
                </div>
              )}
              {order.payments?.some((payment) => payment.paymentMethod === 'efectivo') ? (
                <>
                  <div>
                    <span>Efectivo recibido</span>
                    <span>{formatMoney(order.cashReceivedCents ?? 0)}</span>
                  </div>
                  <div>
                    <span>Cambio</span>
                    <span>{formatMoney(order.changeCents ?? 0)}</span>
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <div>
              <span>Forma de pago</span>
              <strong>Pendiente</strong>
            </div>
          )}
        </section>

        <footer className="receipt-footer">
          <p>¡Gracias por su visita!</p>
          <span>Conserva este ticket como comprobante.</span>
          <small>Casa Roble POS · {order.orderNumber}</small>
        </footer>
      </article>
    </div>
  );
}
