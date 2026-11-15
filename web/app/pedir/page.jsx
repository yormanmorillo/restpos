'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import ProductModifierModal from '@/components/pos/ProductModifierModal';
import { api } from '@/lib/api';
import { calculateTotals } from '@restpos/shared/pricing';
import { formatMoney } from '@/lib/format';

function newKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function lineSignature(productId, notes, modifiers) {
  return `${productId}|${notes}|${(modifiers ?? []).map((modifier) => modifier.modifierId).sort((a, b) => a - b).join(',')}`;
}

export default function PublicOrderPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [cart, setCart] = useState([]);
  const [modifierProduct, setModifierProduct] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [form, setForm] = useState({
    fulfillment: 'pickup',
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getPublicRestaurant();
      setData(response);
      setForm((previous) => ({ ...previous, fulfillment: response.features.onlinePickup ? 'pickup' : 'delivery' }));
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el menú.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allProducts = useMemo(() => (data?.categories ?? []).flatMap((category) => category.products.map((product) => ({ ...product, categoryName: category.name }))), [data]);
  const products = activeCategory === 'all' ? allProducts : allProducts.filter((product) => product.categoryId === activeCategory);
  const taxRateBps = data?.restaurant?.taxRateBps ?? 1600;
  const deliveryFeeCents = data?.features?.deliveryFeeCents ?? 0;
  const delivery = form.fulfillment === 'delivery';

  const totals = useMemo(() => {
    const base = calculateTotals({
      items: cart.map((item) => ({ unitPriceCents: item.unitPriceCents, quantity: item.quantity })),
      taxRateBps,
    });
    return {
      ...base,
      deliveryFeeCents: delivery ? deliveryFeeCents : 0,
      finalTotalCents: base.totalCents + (delivery ? deliveryFeeCents : 0),
    };
  }, [cart, taxRateBps, delivery, deliveryFeeCents]);

  function addProduct(product, notes = '', modifiers = []) {
    const normalized = modifiers.map((modifier) => ({ ...modifier }));
    const signature = lineSignature(product.id, notes.trim(), normalized);
    setCart((previous) => {
      const existing = previous.find((item) => item.signature === signature);
      if (existing) {
        if (existing.quantity >= 30) return previous;
        return previous.map((item) => item.signature === signature ? { ...item, quantity: item.quantity + 1 } : item);
      }
      const unitPriceCents = product.priceCents + normalized.reduce((sum, modifier) => sum + modifier.priceDeltaCents, 0);
      return [...previous, {
        key: newKey(),
        signature,
        productId: product.id,
        name: product.name,
        unitPriceCents,
        quantity: 1,
        notes: notes.trim(),
        modifiers: normalized,
      }];
    });
    setModifierProduct(null);
  }

  function selectProduct(product) {
    if ((product.modifierGroups ?? []).length > 0) setModifierProduct(product);
    else addProduct(product);
  }

  function changeQuantity(key, delta) {
    setCart((previous) => previous.flatMap((item) => {
      if (item.key !== key) return [item];
      const quantity = item.quantity + delta;
      return quantity <= 0 ? [] : [{ ...item, quantity }];
    }));
  }

  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const canCheckout = cart.length > 0 && (form.fulfillment === 'pickup' ? data?.features?.onlinePickup : data?.features?.onlineDelivery);

  async function submitOrder() {
    setCheckoutError('');
    if (!form.customerName.trim()) { setCheckoutError('Escribe tu nombre.'); return; }
    if (form.customerPhone.trim().length < 7) { setCheckoutError('Escribe un teléfono válido.'); return; }
    if (delivery && form.deliveryAddress.trim().length < 8) { setCheckoutError('Escribe una dirección completa.'); return; }
    setSubmitting(true);
    try {
      const response = await api.createPublicOrder({
        fulfillment: form.fulfillment,
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        deliveryAddress: delivery ? form.deliveryAddress.trim() : '',
        notes: form.notes.trim(),
        items: cart.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          notes: item.notes,
          modifiers: item.modifiers.map((modifier) => modifier.modifierId),
        })),
      });
      setConfirmation(response.order);
      setCheckoutOpen(false);
      setCartOpen(false);
      setCart([]);
    } catch (submitError) {
      setCheckoutError(submitError.message || 'No se pudo enviar el pedido.');
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <main className="public-confirmation">
        <div className="public-confirmation-card">
          <span className="success-check"><Icon name="check" size={38} /></span>
          <span className="eyebrow">Pedido recibido</span>
          <h1>{confirmation.orderNumber}</h1>
          <p>Tu pedido fue enviado al restaurante. Te contactaremos al teléfono registrado.</p>
          <div className="public-confirm-summary">
            <div><span>Total</span><strong>{formatMoney(confirmation.totalCents)}</strong></div>
            <div><span>Entrega</span><strong>{confirmation.fulfillment === 'delivery' ? 'A domicilio' : 'Recoger en restaurante'}</strong></div>
          </div>
          <button type="button" className="btn btn-primary btn-large" onClick={() => { setConfirmation(null); setData(null); setLoading(true); void load(); }}>Hacer otro pedido</button>
        </div>
      </main>
    );
  }

  return (
    <main className="public-page">
      <header className="public-header">
        <a href="/pedir" className="public-brand">
          <span className="brand-mark"><img src="/matmax-logo.jpg" alt="" className="brand-mark-logo" /></span>
          <span><strong>{data?.restaurant?.name ?? 'Casa Roble'}</strong><small>Pedidos en línea</small></span>
        </a>
        <span className="public-header-note">Hecho con ingredientes de la casa</span>
      </header>

      {loading ? (
        <div className="app-loading"><span className="spinner" /> Cargando menú…</div>
      ) : error && !data ? (
        <div className="public-closed">
          <Icon name="clock" size={34} />
          <h1>Pedidos en línea cerrados</h1>
          <p>{error}</p>
          <button type="button" className="btn btn-primary" onClick={() => void load()}>Reintentar</button>
        </div>
      ) : (
        <div className="public-layout">
          <section className="public-menu">
            <div className="public-hero">
              <span className="eyebrow">Casa Roble · Cocina de la casa</span>
              <h1>Pide para llevar o delivery</h1>
              <p>Elige tus platillos favoritos y nosotros nos encargamos del resto.</p>
              <div className="service-switch">
                {data.features.onlinePickup ? (
                  <button type="button" className={form.fulfillment === 'pickup' ? 'is-active' : ''} onClick={() => setForm((previous) => ({ ...previous, fulfillment: 'pickup' }))}><Icon name="bag" size={19} /> Recoger</button>
                ) : null}
                {data.features.onlineDelivery ? (
                  <button type="button" className={form.fulfillment === 'delivery' ? 'is-active' : ''} onClick={() => setForm((previous) => ({ ...previous, fulfillment: 'delivery' }))}><Icon name="pin" size={19} /> Delivery</button>
                ) : null}
              </div>
            </div>

            <div className="category-strip public-categories">
              <button type="button" className={`category-chip ${activeCategory === 'all' ? 'is-active' : ''}`} onClick={() => setActiveCategory('all')}>Todo</button>
              {data.categories.map((category) => (
                <button key={category.id} type="button" className={`category-chip ${activeCategory === category.id ? 'is-active' : ''}`} onClick={() => setActiveCategory(category.id)}>{category.name}</button>
              ))}
            </div>

            <div className="public-product-grid">
              {products.map((product) => (
                <button key={product.id} type="button" className={`public-product-card ${product.soldOut ? 'is-soldout' : ''}`} onClick={() => { if (!product.soldOut) selectProduct(product); }} disabled={product.soldOut}>
                  {product.imageUrl ? (
                    <div className="public-product-media"><img src={product.imageUrl} alt={product.name} loading="lazy" /></div>
                  ) : (
                    <div className="public-product-placeholder"><Icon name="leaf" size={28} /></div>
                  )}
                  <div className="public-product-copy">
                    {product.soldOut ? <span className="product-soldout">Agotado</span> : null}
                    <span>{product.categoryName}</span>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>
                    <div><strong>{formatMoney(product.priceCents)}</strong><span className="public-add"><Icon name="plus" size={20} /></span></div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <aside className="public-cart">
            <div className="public-cart-head"><h2>Tu pedido</h2><span>{itemCount} {itemCount === 1 ? 'artículo' : 'artículos'}</span></div>
            {cart.length === 0 ? (
              <div className="public-cart-empty"><Icon name="bag" size={30} /><h3>Tu pedido está vacío</h3><p>Agrega productos del menú.</p></div>
            ) : (
              <>
                <div className="public-cart-items">
                  {cart.map((item) => (
                    <div key={item.key} className="public-cart-item">
                      <div><strong>{item.name}</strong><span>{formatMoney(item.unitPriceCents)} c/u</span>{item.modifiers.map((modifier) => <small key={modifier.modifierId}>+ {modifier.modifierName}</small>)}{item.notes ? <small>{item.notes}</small> : null}</div>
                      <div className="public-qty"><button type="button" onClick={() => changeQuantity(item.key, -1)}><Icon name="minus" size={15} /></button><span>{item.quantity}</span><button type="button" onClick={() => changeQuantity(item.key, 1)}><Icon name="plus" size={15} /></button></div>
                      <strong>{formatMoney(item.unitPriceCents * item.quantity)}</strong>
                    </div>
                  ))}
                </div>
                <div className="public-totals">
                  <div><span>Subtotal</span><span>{formatMoney(totals.subtotalCents)}</span></div>
                  <div><span>Impuesto ({taxRateBps / 100}%)</span><span>{formatMoney(totals.taxCents)}</span></div>
                  {delivery && totals.deliveryFeeCents > 0 ? <div><span>Envío</span><span>{formatMoney(totals.deliveryFeeCents)}</span></div> : null}
                  <div className="public-total"><span>Total</span><strong>{formatMoney(totals.finalTotalCents)}</strong></div>
                </div>
                <button type="button" className="btn btn-primary btn-large public-checkout-button" onClick={() => { if (canCheckout) setCheckoutOpen(true); else setCheckoutError('No hay servicio disponible.'); }} disabled={!canCheckout}>Continuar pedido</button>
                {checkoutError ? <p className="form-error">{checkoutError}</p> : null}
              </>
            )}
          </aside>

          <button type="button" className="public-cart-bar" onClick={() => setCartOpen(true)}>
            <span><Icon name="bag" size={19} /> {itemCount} artículos</span><strong>{formatMoney(totals.finalTotalCents)} · Ver pedido</strong>
          </button>
        </div>
      )}

      <Modal open={cartOpen} onClose={() => setCartOpen(false)} title="Tu pedido" subtitle={`${itemCount} artículos`} size="md">
        {cart.length === 0 ? <p className="field-hint">Agrega productos del menú.</p> : (
          <div className="public-cart-items">
            {cart.map((item) => (
              <div key={item.key} className="public-cart-item">
                <div><strong>{item.name}</strong><span>{formatMoney(item.unitPriceCents)} c/u</span></div>
                <div className="public-qty"><button type="button" onClick={() => changeQuantity(item.key, -1)}><Icon name="minus" size={15} /></button><span>{item.quantity}</span><button type="button" onClick={() => changeQuantity(item.key, 1)}><Icon name="plus" size={15} /></button></div>
                <strong>{formatMoney(item.unitPriceCents * item.quantity)}</strong>
              </div>
            ))}
            <div className="public-total"><span>Total</span><strong>{formatMoney(totals.finalTotalCents)}</strong></div>
            <button type="button" className="btn btn-primary btn-large" onClick={() => { setCartOpen(false); setCheckoutOpen(true); }}>Continuar pedido</button>
          </div>
        )}
      </Modal>

      <Modal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        title="Datos de tu pedido"
        subtitle={delivery ? 'Entrega a domicilio' : 'Recoger en restaurante'}
        size="md"
        closeDisabled={submitting}
        footer={
          <div className="modal-actions">
            <span />
            <div className="modal-actions-right">
              <button type="button" className="btn btn-secondary" onClick={() => setCheckoutOpen(false)} disabled={submitting}>Volver</button>
              <button type="button" className="btn btn-primary" onClick={() => void submitOrder()} disabled={submitting}>
                {submitting ? <span className="spinner spinner-small" /> : <Icon name="check" size={18} />} Enviar pedido · {formatMoney(totals.finalTotalCents)}
              </button>
            </div>
          </div>
        }
      >
        <div className="form-grid">
          <label className="field"><span className="field-label">Nombre</span><input className="input" value={form.customerName} onChange={(event) => setForm((previous) => ({ ...previous, customerName: event.target.value }))} maxLength={100} autoFocus /></label>
          <label className="field"><span className="field-label">Teléfono</span><input className="input" type="tel" value={form.customerPhone} onChange={(event) => setForm((previous) => ({ ...previous, customerPhone: event.target.value }))} maxLength={30} /></label>
          {delivery ? <label className="field field-full"><span className="field-label">Dirección de entrega</span><input className="input" value={form.deliveryAddress} onChange={(event) => setForm((previous) => ({ ...previous, deliveryAddress: event.target.value }))} maxLength={300} /></label> : null}
          <label className="field field-full"><span className="field-label">Notas para el restaurante</span><input className="input" value={form.notes} onChange={(event) => setForm((previous) => ({ ...previous, notes: event.target.value }))} maxLength={500} placeholder="Opcional" /></label>
          {checkoutError ? <p className="form-error field-full">{checkoutError}</p> : null}
        </div>
      </Modal>

      <ProductModifierModal
        open={Boolean(modifierProduct)}
        product={modifierProduct}
        onClose={() => setModifierProduct(null)}
        onAdd={(product, notes, modifiers) => addProduct(product, notes, modifiers)}
      />
    </main>
  );
}
