'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { formatMoney, formatTime } from '@/lib/format';

export default function PublicReceiptPage() {
  const { token } = useParams();
  const [receipt, setReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    api.getPublicReceipt(token)
      .then((response) => setReceipt(response.receipt))
      .catch((loadError) => setError(loadError.message || 'No se encontró la factura.'))
      .finally(() => setLoading(false));
  }, [token]);

  function shareWhatsApp() {
    if (!receipt) return;
    const text = `${receipt.restaurantName} · Pedido ${receipt.orderNumber}\nTotal: ${formatMoney(receipt.totalCents, { currency: receipt.currency })}\n${window.location.href}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  }

  if (loading) return <main className="public-receipt-state"><span className="spinner" /><p>Cargando factura…</p></main>;
  if (error || !receipt) return <main className="public-receipt-state"><Icon name="alert" size={30} /><h1>Factura no disponible</h1><p>{error}</p></main>;

  const service = receipt.serviceType === 'delivery' ? 'Delivery' : receipt.serviceType === 'dine_in' ? `Comer aquí${receipt.tableName ? ` · ${receipt.tableName}` : ''}` : 'Para llevar';

  return (
    <main className="public-receipt-page">
      <div className="public-receipt-actions no-print">
        <button type="button" className="btn btn-secondary" onClick={() => window.print()}><Icon name="printer" size={18} /> Imprimir</button>
        <button type="button" className="btn btn-primary" onClick={shareWhatsApp}><Icon name="whatsapp" size={18} /> Compartir</button>
      </div>
      <article className="public-receipt-card">
        <header>
          <span className="receipt-leaf"><Icon name="leaf" size={24} /></span>
          <h1>{receipt.restaurantName}</h1>
          <p>Factura de consumo</p>
          <span>{receipt.orderNumber} · {service}</span>
        </header>
        <div className="public-receipt-rule" />
        <div className="public-receipt-meta">
          <span>Fecha</span><strong>{receipt.businessDate}</strong>
          <span>Hora</span><strong>{formatTime(receipt.paidAt, receipt.timezone)}</strong>
          {receipt.customerName ? <><span>Cliente</span><strong>{receipt.customerName}</strong></> : null}
        </div>
        <div className="public-receipt-items">
          {receipt.items.map((item) => (
            <div key={item.id} className="public-receipt-item">
              <span>{item.quantity}</span>
              <div>
                <strong>{item.productName}</strong>
                {item.modifiers.length ? <small>{item.modifiers.join(' · ')}</small> : null}
                {item.notes ? <small>{item.notes}</small> : null}
              </div>
              <strong>{formatMoney(item.lineTotalCents, { currency: receipt.currency })}</strong>
            </div>
          ))}
        </div>
        <div className="public-receipt-totals">
          <div><span>Subtotal</span><span>{formatMoney(receipt.subtotalCents, { currency: receipt.currency })}</span></div>
          {receipt.discountCents > 0 ? <div><span>Descuento</span><span>-{formatMoney(receipt.discountCents, { currency: receipt.currency })}</span></div> : null}
          <div><span>Impuesto ({receipt.taxRateBps / 100}%)</span><span>{formatMoney(receipt.taxCents, { currency: receipt.currency })}</span></div>
          {receipt.deliveryFeeCents > 0 ? <div><span>Entrega</span><span>{formatMoney(receipt.deliveryFeeCents, { currency: receipt.currency })}</span></div> : null}
          {receipt.tipCents > 0 ? <div><span>Propina</span><span>{formatMoney(receipt.tipCents, { currency: receipt.currency })}</span></div> : null}
          <div className="is-total"><span>Total</span><strong>{formatMoney(receipt.totalCents, { currency: receipt.currency })}</strong></div>
        </div>
        <div className="public-receipt-payments">
          {receipt.payments.map((payment, index) => (
            <div key={`${payment.methodName}-${index}`}><span>{payment.methodName}</span><span>{formatMoney(payment.amountCents, { currency: receipt.currency })}</span></div>
          ))}
        </div>
        <p className="public-receipt-legal">Documento informativo. No sustituye la factura electrónica cuando sea requerida.</p>
        <small className="public-receipt-brand">Casa Roble POS · MATMAX IT Solutions</small>
      </article>
    </main>
  );
}
