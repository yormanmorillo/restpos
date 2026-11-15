'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Icon from '@/components/Icon';
import { useAuth } from '@/components/auth/AuthProvider';
import { useFeatures } from '@/components/FeatureProvider';
import { calculateTotals } from '@restpos/shared/pricing';
import { parseMoneyToCents } from '@restpos/shared/money';
import { formatMoney } from '@/lib/format';
import { enqueueOfflineSale, flushOfflineQueue, readCachedCatalog, readQueue } from '@/lib/offline';

function newOperationId() {
  return globalThis.crypto?.randomUUID?.() ?? `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function OfflineSalePage() {
  const { staff } = useAuth();
  const { enabled } = useFeatures();
  const [catalog, setCatalog] = useState(null);
  const [cart, setCart] = useState([]);
  const [categoryId, setCategoryId] = useState('all');
  const [cashInput, setCashInput] = useState('0.00');
  const [customerName, setCustomerName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    setCatalog(readCachedCatalog());
    setQueue(readQueue());
  }, []);

  const products = useMemo(() => (catalog?.categories ?? []).flatMap((category) => category.products.map((product) => ({ ...product, categoryName: category.name }))), [catalog]);
  const visible = categoryId === 'all' ? products : products.filter((product) => product.categoryId === categoryId);
  const totals = useMemo(() => calculateTotals({
    items: cart.map((item) => ({ unitPriceCents: item.unitPriceCents, quantity: item.quantity })),
    taxRateBps: Number(catalog?.taxRateBps ?? 1300),
  }), [cart, catalog]);

  function add(product) {
    setCart((previous) => {
      const existing = previous.find((item) => item.productId === product.id);
      if (existing) return previous.map((item) => item.productId === product.id ? { ...item, quantity: Math.min(99, item.quantity + 1) } : item);
      return [...previous, { productId: product.id, name: product.name, unitPriceCents: product.priceCents, quantity: 1 }];
    });
    setError('');
  }

  function setQuantity(productId, quantity) {
    if (quantity <= 0) { setCart((previous) => previous.filter((item) => item.productId !== productId)); return; }
    setCart((previous) => previous.map((item) => item.productId === productId ? { ...item, quantity: Math.min(99, quantity) } : item));
  }

  function queueSale() {
    if (!staff) { setError('No hay una sesión disponible.'); return; }
    if (cart.length === 0) { setError('Agrega al menos un producto.'); return; }
    let cashCents;
    try { cashCents = parseMoneyToCents(cashInput); } catch { setError('Escribe un efectivo válido.'); return; }
    if (cashCents < totals.totalCents) { setError(`El efectivo debe cubrir ${formatMoney(totals.totalCents)}.`); return; }
    const sale = {
      operationId: newOperationId(),
      occurredAt: new Date().toISOString(),
      customerName: customerName.trim(),
      items: cart.map((item) => ({ productId: item.productId, quantity: item.quantity, notes: '' })),
      cashReceivedCents: cashCents,
      expectedTotalCents: totals.totalCents,
    };
    setQueue(enqueueOfflineSale(sale));
    setCart([]);
    setCashInput('0.00');
    setCustomerName('');
    setError('');
    setNotice('Venta guardada en la cola offline. Se sincronizará al recuperar la conexión.');
    if (navigator.onLine) {
      void flushOfflineQueue().then(() => setQueue(readQueue()));
    }
  }

  async function sync() {
    setError('');
    const result = await flushOfflineQueue();
    setQueue(readQueue());
    setNotice(result.synced > 0 ? `${result.synced} venta(s) sincronizada(s).` : 'No se pudo sincronizar todavía.');
  }

  if (!enabled('offline_mode')) {
    return <div className="empty-panel"><Icon name="alert" size={30} /><h3>Modo offline desactivado</h3><p>El super admin debe activarlo en Ajustes → Funciones activables.</p><Link href="/" className="btn btn-primary">Volver al POS</Link></div>;
  }

  if (!catalog) {
    return <div className="empty-panel"><Icon name="alert" size={30} /><h3>Sin catálogo local</h3><p>Abre el POS con conexión al menos una vez para descargar el menú.</p><Link href="/" className="btn btn-primary">Volver al POS</Link></div>;
  }

  return (
    <div className="offline-page">
      <div className="page-heading">
        <div><span className="eyebrow">Modo sin conexión</span><h1>Venta offline</h1><p>Ventas para llevar en efectivo. Se sincronizan al volver la conexión.</p></div>
        <div className="heading-actions"><Link href="/" className="btn btn-secondary"><Icon name="arrowLeft" size={18} /> Volver al POS</Link><button type="button" className="btn btn-primary" onClick={() => void sync()} disabled={queue.length === 0}><Icon name="refresh" size={18} /> Sincronizar ({queue.length})</button></div>
      </div>
      <div className="offline-layout">
        <section className="panel offline-products">
          <div className="admin-toolbar"><div><h2>Productos</h2><p>Precios del último catálogo descargado</p></div></div>
          <div className="category-strip">
            <button type="button" className={`category-chip ${categoryId === 'all' ? 'is-active' : ''}`} onClick={() => setCategoryId('all')}>Todo <span>{products.length}</span></button>
            {(catalog.categories ?? []).map((category) => <button key={category.id} type="button" className={`category-chip ${categoryId === category.id ? 'is-active' : ''}`} onClick={() => setCategoryId(category.id)}>{category.name} <span>{category.products.length}</span></button>)}
          </div>
          <div className="offline-product-grid">
            {visible.map((product) => <button key={product.id} type="button" className="offline-product" onClick={() => add(product)}><strong>{product.name}</strong><span>{formatMoney(product.priceCents)}</span></button>)}
          </div>
        </section>
        <aside className="panel offline-cart">
          <h2>Venta</h2>
          {cart.length === 0 ? <p className="field-hint">Agrega productos del menú.</p> : (
            <div className="offline-cart-list">
              {cart.map((item) => <div key={item.productId} className="offline-cart-row"><div><strong>{item.name}</strong><span>{formatMoney(item.unitPriceCents)}</span></div><div className="qty-stepper"><button type="button" onClick={() => setQuantity(item.productId, item.quantity - 1)}>−</button><span>{item.quantity}</span><button type="button" onClick={() => setQuantity(item.productId, item.quantity + 1)}>+</button></div></div>)}
            </div>
          )}
          <label className="field"><span className="field-label">Cliente <small>opcional</small></span><input className="input" value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength={100} /></label>
          <div className="summary-row"><span>Subtotal</span><span>{formatMoney(totals.subtotalCents)}</span></div>
          <div className="summary-row"><span>IVA ({catalog.taxRateBps / 100}%)</span><span>{formatMoney(totals.taxCents)}</span></div>
          <div className="summary-row summary-total"><span>Total</span><strong>{formatMoney(totals.totalCents)}</strong></div>
          <label className="field"><span className="field-label">Efectivo recibido</span><div className="money-input-wrap"><span className="money-prefix">₡</span><input className="input money-input" inputMode="decimal" value={cashInput} onChange={(event) => setCashInput(event.target.value)} /></div></label>
          {error ? <p className="form-error">{error}</p> : null}
          {notice ? <p className="alert alert-success">{notice}</p> : null}
          <button type="button" className="btn btn-primary btn-charge" onClick={queueSale} disabled={cart.length === 0}><Icon name="cash" size={20} /> Guardar venta offline</button>
          <p className="field-hint">Solo efectivo y para llevar. No incluye modificadores, propinas ni impresión.</p>
        </aside>
      </div>
    </div>
  );
}
