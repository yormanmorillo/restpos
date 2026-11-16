'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { calculateTotals } from '@restpos/shared/pricing';
import { formatMoney } from '@/lib/format';

export default function TableOrderPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [cart, setCart] = useState([]);
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmation, setConfirmation] = useState(null);

  useEffect(() => {
    api.getPublicTable(token).then(setData).catch((e) => setError(e.message || 'No se pudo abrir la mesa.'));
  }, [token]);

  const products = useMemo(() => (data?.categories ?? []).flatMap((category) => category.products.map((product) => ({ ...product, categoryName: category.name }))), [data]);
  const totals = useMemo(() => calculateTotals({ items: cart.map((item) => ({ unitPriceCents: item.unitPriceCents, quantity: item.quantity })), taxRateBps: data?.restaurant?.taxRateBps ?? 1300 }), [cart, data]);

  function add(product) {
    if (product.soldOut) return;
    setCart((previous) => {
      const existing = previous.find((item) => item.productId === product.id);
      if (existing) return previous.map((item) => item.productId === product.id ? { ...item, quantity: Math.min(30, item.quantity + 1) } : item);
      return [...previous, { productId: product.id, name: product.name, unitPriceCents: product.priceCents, quantity: 1 }];
    });
  }
  function quantity(productId, next) {
    if (next <= 0) { setCart((previous) => previous.filter((item) => item.productId !== productId)); return; }
    setCart((previous) => previous.map((item) => item.productId === productId ? { ...item, quantity: Math.min(30, next) } : item));
  }
  async function submit() {
    if (cart.length === 0) { setError('Agrega al menos un producto.'); return; }
    setSubmitting(true); setError('');
    try {
      const response = await api.createPublicTableOrder(token, { customerName: customerName.trim(), notes: notes.trim(), items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity })) });
      setConfirmation(response);
      setCart([]);
    } catch (e) { setError(e.message || 'No se pudo enviar el pedido.'); }
    finally { setSubmitting(false); }
  }

  if (error && !data) return <main className="public-page"><div className="empty-panel"><Icon name="alert" size={30} /><h1>QR no disponible</h1><p>{error}</p></div></main>;
  if (!data) return <main className="public-page"><div className="app-loading"><span className="spinner" /> Abriendo mesa…</div></main>;

  return (
    <main className="public-page table-order-page">
      <header className="public-header"><div><span className="eyebrow">{data.restaurant.name}</span><h1>{data.table.name}</h1><p>{data.table.areaName || 'Pedido en mesa'}</p></div><span className="table-badge">Mesa</span></header>
      {confirmation ? (
        <section className="panel table-confirmation"><Icon name="check" size={34} /><h2>Pedido recibido</h2><p>Pedido <strong>{confirmation.order.orderNumber}</strong> · {formatMoney(confirmation.order.totalCents)}</p><p className="field-hint">El mesero debe aprobarlo y enviarlo a cocina. También puede agregar más productos o cobrar la cuenta.</p><button type="button" className="btn btn-primary" onClick={() => setConfirmation(null)}>Pedir algo más</button></section>
      ) : (
        <div className="table-order-layout">
          <section className="panel table-products"><h2>Menú</h2>{(data.categories ?? []).map((category) => <div key={category.id} className="table-category"><h3>{category.name}</h3><div className="table-product-grid">{category.products.map((product) => <button key={product.id} type="button" className={`table-product ${product.soldOut ? 'is-soldout' : ''}`} disabled={product.soldOut} onClick={() => add(product)}><strong>{product.name}</strong><span>{product.soldOut ? 'Agotado' : formatMoney(product.priceCents)}</span></button>)}</div></div>)}</section>
          <aside className="panel table-cart"><h2>Tu pedido</h2>{cart.length === 0 ? <p className="field-hint">Agrega productos del menú.</p> : cart.map((item) => <div key={item.productId} className="table-cart-row"><div><strong>{item.name}</strong><span>{formatMoney(item.unitPriceCents)}</span></div><div className="qty-stepper"><button type="button" onClick={() => quantity(item.productId, item.quantity - 1)}>−</button><span>{item.quantity}</span><button type="button" onClick={() => quantity(item.productId, item.quantity + 1)}>+</button></div></div>)}
            <div className="summary-row"><span>Subtotal</span><span>{formatMoney(totals.subtotalCents)}</span></div><div className="summary-row"><span>IVA</span><span>{formatMoney(totals.taxCents)}</span></div><div className="summary-row summary-total"><span>Total</span><strong>{formatMoney(totals.totalCents)}</strong></div>
            <label className="field"><span className="field-label">Tu nombre <small>opcional</small></span><input className="input" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={100} /></label>
            <label className="field"><span className="field-label">Notas <small>opcional</small></span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} /></label>
            {error ? <p className="form-error">{error}</p> : null}
            <button type="button" className="btn btn-primary btn-charge" onClick={() => void submit()} disabled={submitting || cart.length === 0}>{submitting ? 'Enviando…' : 'Enviar al mesero'}</button>
            <p className="field-hint">El pago se realiza con el mesero. Los precios finales se confirman en caja.</p>
          </aside>
        </div>
      )}
    </main>
  );
}
