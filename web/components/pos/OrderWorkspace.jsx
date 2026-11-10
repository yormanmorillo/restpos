'use client';

import { useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { formatPercentBps } from '@restpos/shared/money';
import { api } from '@/lib/api';
import { formatMoney, paymentLabel, productQtyInOrder } from '@/lib/format';
import { useDraftOrder } from '@/lib/useDraftOrder';
import DiscountModal from './DiscountModal';
import PaymentModal from './PaymentModal';

function SaveIndicator({ status }) {
  const labels = {
    saved: 'Guardado',
    pending: 'Guardando…',
    saving: 'Guardando…',
    error: 'Sin guardar',
  };
  return (
    <span className={`save-indicator save-${status}`} role="status" aria-live="polite">
      {status === 'saving' || status === 'pending' ? (
        <span className="spinner spinner-tiny" aria-hidden="true" />
      ) : status === 'error' ? (
        <Icon name="alert" size={15} />
      ) : (
        <Icon name="check" size={15} />
      )}
      {labels[status] ?? labels.saved}
    </span>
  );
}

function PaymentSuccess({ order, onNewOrder }) {
  const [openingReceipt, setOpeningReceipt] = useState(false);

  function openReceipt(autoPrint = false) {
    setOpeningReceipt(true);
    window.open(`/recibo/${order.id}${autoPrint ? '?print=1' : ''}`, '_blank', 'noopener,noreferrer');
    setTimeout(() => setOpeningReceipt(false), 600);
  }

  return (
    <div className="success-screen">
      <div className="success-card">
        <div className="success-check">
          <Icon name="check" size={40} />
        </div>
        <span className="eyebrow">Venta completada</span>
        <h1>{formatMoney(order.totalCents)}</h1>
        <p className="success-subtitle">
          {order.orderNumber} · {order.type === 'mesa' ? order.tableName : 'Para llevar'} ·{' '}
          {paymentLabel(order.paymentMethod)}
        </p>

        <div className="success-summary">
          <div>
            <span>Subtotal</span>
            <strong>{formatMoney(order.subtotalCents)}</strong>
          </div>
          <div>
            <span>Descuento</span>
            <strong>{order.discountCents > 0 ? `-${formatMoney(order.discountCents)}` : formatMoney(0)}</strong>
          </div>
          <div>
            <span>Impuesto</span>
            <strong>{formatMoney(order.taxCents)}</strong>
          </div>
          <div>
            <span>Propina</span>
            <strong>{formatMoney(order.tipCents)}</strong>
          </div>
          <div>
            <span>Forma de pago</span>
            <strong>{paymentLabel(order.paymentMethod)}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{formatMoney(order.totalCents)}</strong>
          </div>
          {order.paymentMethod === 'efectivo' ? (
            <>
              <div>
                <span>Efectivo recibido</span>
                <strong>{formatMoney(order.cashReceivedCents ?? 0)}</strong>
              </div>
              <div className="success-change">
                <span>Cambio</span>
                <strong>{formatMoney(order.changeCents ?? 0)}</strong>
              </div>
            </>
          ) : null}
        </div>

        <div className="success-actions">
          <button type="button" className="btn btn-secondary btn-large" onClick={() => openReceipt(true)} disabled={openingReceipt}>
            <Icon name="printer" size={21} />
            Imprimir ticket
          </button>
          <button type="button" className="btn btn-primary btn-large" onClick={() => onNewOrder(order)}>
            <Icon name="plus" size={21} />
            Nuevo pedido
          </button>
        </div>
        <button type="button" className="text-button" onClick={() => openReceipt(false)}>
          Solo ver el ticket
        </button>
      </div>
    </div>
  );
}

export default function OrderWorkspace({ initialOrder, catalog, onExit, onCompleted }) {
  const {
    order,
    saving,
    saveStatus,
    saveError,
    addProduct,
    setItemQuantity,
    removeItem,
    setItemNotes,
    setDiscount,
    setTip,
    setCustomerName,
    flush,
    retrySave,
  } = useDraftOrder(initialOrder);
  const [categoryId, setCategoryId] = useState(() => catalog?.categories?.[0]?.id ?? 'all');
  const [search, setSearch] = useState('');
  const [cartOpen, setCartOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [noteEditor, setNoteEditor] = useState(null);
  const [paidOrder, setPaidOrder] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [completing, setCompleting] = useState(false);

  const allProducts = useMemo(
    () =>
      (catalog?.categories ?? []).flatMap((category) =>
        category.products.map((product) => ({ ...product, categoryName: category.name })),
      ),
    [catalog],
  );

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');
    if (query) {
      return allProducts.filter(
        (product) =>
          product.name.toLocaleLowerCase('es').includes(query) ||
          product.description.toLocaleLowerCase('es').includes(query) ||
          product.categoryName.toLocaleLowerCase('es').includes(query),
      );
    }
    if (categoryId === 'all') return allProducts;
    return allProducts.filter((product) => product.categoryId === categoryId);
  }, [allProducts, categoryId, search]);

  const itemCount = order.items.reduce((sum, item) => sum + item.quantity, 0);
  const cartTitle = order.type === 'mesa' ? order.tableName : 'Para llevar';

  if (paidOrder) {
    return (
      <PaymentSuccess
        order={paidOrder}
        onNewOrder={async (completed) => {
          if (completing) return;
          setCompleting(true);
          await onCompleted(completed);
        }}
      />
    );
  }

  function productCard(product) {
    const quantity = productQtyInOrder(order, product.id);
    const disabled = !product.active;
    return (
      <button
        key={product.id}
        type="button"
        className={`product-card ${disabled ? 'is-unavailable' : ''}`}
        onClick={() => {
          if (!disabled) addProduct(product);
        }}
        disabled={disabled}
        aria-label={`${product.name}, ${formatMoney(product.priceCents)}${disabled ? ', no disponible' : '. Agregar al pedido.'}`}
      >
        <div className="product-card-heading">
          {search.trim() || categoryId === 'all' ? <span className="product-category">{product.categoryName}</span> : null}
          <h3>{product.name}</h3>
          {product.description ? <p>{product.description}</p> : null}
        </div>
        <div className="product-card-footer">
          <strong>{formatMoney(product.priceCents)}</strong>
          <span className={`product-add ${disabled ? 'is-disabled' : ''}`} aria-hidden="true">
            {disabled ? (
              'Agotado'
            ) : quantity > 0 ? (
              <span className="product-quantity">{quantity}</span>
            ) : (
              <Icon name="plus" size={22} />
            )}
          </span>
        </div>
      </button>
    );
  }

  async function handleExit() {
    if (leaving) return;
    setActionError('');
    setLeaving(true);
    try {
      try {
        await flush();
      } catch (saveFailure) {
        if (order.items.length > 0) throw saveFailure;
      }
      if (order.items.length === 0) {
        try {
          await api.cancelOrder(order.id);
        } catch (cancelError) {
          if (cancelError?.status !== 409) throw cancelError;
        }
      }
      onExit();
    } catch (exitError) {
      setActionError(exitError?.message || 'No se pudo guardar el pedido. Reintenta antes de salir.');
    } finally {
      setLeaving(false);
    }
  }

  function openNoteEditor(item) {
    setNoteEditor({ clientKey: item.clientKey, value: item.notes ?? '' });
  }

  function saveNote() {
    if (!noteEditor) return;
    setItemNotes(noteEditor.clientKey, noteEditor.value.trim());
    setNoteEditor(null);
  }

  async function handlePaymentConfirm(payload) {
    await flush();
    const response = await api.payOrder(order.id, payload);
    setPaidOrder(response.order);
    setPaymentOpen(false);
    setCartOpen(false);
  }

  const discountText =
    order.discountType === 'percent'
      ? formatPercentBps(order.discountValue)
      : order.discountType === 'fixed'
        ? formatMoney(order.discountValue)
        : '';

  return (
    <div className="order-workspace">
      <header className="workspace-topbar">
        <button
          type="button"
          className="btn btn-ghost btn-back"
          onClick={() => void handleExit()}
          disabled={leaving || saving}
        >
          <Icon name="arrowLeft" size={21} />
          <span>{leaving ? 'Guardando…' : 'Mesas'}</span>
        </button>

        <div className="workspace-title">
          <span className="eyebrow">
            {order.type === 'mesa' ? 'Pedido en mesa' : 'Pedido para llevar'} · {order.orderNumber}
          </span>
          <h1>{cartTitle}</h1>
        </div>

        <div className="workspace-status">
          <SaveIndicator status={saveStatus} />
          <button
            type="button"
            className="icon-button mobile-cart-trigger"
            onClick={() => setCartOpen(true)}
            aria-label={`Ver pedido, ${itemCount} artículos, total ${formatMoney(order.totalCents)}`}
          >
            <Icon name="receipt" size={22} />
            {itemCount > 0 ? <span className="icon-badge">{itemCount}</span> : null}
          </button>
        </div>
      </header>

      {saveError ? (
        <div className="alert alert-error workspace-alert" role="alert">
          <Icon name="alert" size={19} />
          <div>
            <strong>No se pudo guardar</strong>
            <p>{saveError}</p>
          </div>
          <button type="button" className="btn btn-small btn-secondary" onClick={() => void retrySave()}>
            <Icon name="refresh" size={16} />
            Reintentar
          </button>
        </div>
      ) : null}

      <div className="workspace-grid">
        <section className="menu-pane" aria-label="Menú">
          <div className="menu-controls">
            <label className="search-field">
              <Icon name="search" size={20} />
              <input
                type="search"
                placeholder="Buscar platillo o bebida…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Buscar en el menú"
              />
              {search ? (
                <button type="button" className="search-clear" onClick={() => setSearch('')} aria-label="Limpiar búsqueda">
                  <Icon name="close" size={17} />
                </button>
              ) : null}
            </label>
          </div>

          <div className="category-strip" role="tablist" aria-label="Categorías del menú">
            <button
              type="button"
              role="tab"
              aria-selected={categoryId === 'all' && !search}
              className={`category-chip ${categoryId === 'all' && !search ? 'is-active' : ''}`}
              onClick={() => {
                setCategoryId('all');
                setSearch('');
              }}
            >
              Todo
              <span>{allProducts.length}</span>
            </button>
            {(catalog?.categories ?? []).map((category) => (
              <button
                key={category.id}
                type="button"
                role="tab"
                aria-selected={categoryId === category.id && !search}
                className={`category-chip ${categoryId === category.id && !search ? 'is-active' : ''}`}
                onClick={() => {
                  setCategoryId(category.id);
                  setSearch('');
                }}
              >
                {category.name}
                <span>{category.products.length}</span>
              </button>
            ))}
          </div>

          <div className="menu-results-heading">
            <span>
              {search
                ? `${filteredProducts.length} resultados para “${search}”`
                : categoryId === 'all'
                  ? 'Todo el menú'
                  : (catalog?.categories ?? []).find((category) => category.id === categoryId)?.name}
            </span>
            <span className="menu-hint">Toca un producto para agregarlo</span>
          </div>

          <div className="product-grid">
            {filteredProducts.length === 0 ? (
              <div className="empty-menu">
                <Icon name="search" size={30} />
                <h3>Sin resultados</h3>
                <p>Prueba con otro nombre o cambia de categoría.</p>
              </div>
            ) : (
              filteredProducts.map(productCard)
            )}
          </div>
        </section>

        <button
          type="button"
          className={`sheet-backdrop ${cartOpen ? 'is-visible' : ''}`}
          onClick={() => setCartOpen(false)}
          aria-label="Cerrar pedido"
          tabIndex={cartOpen ? 0 : -1}
        />

        <aside className={`ticket-panel ${cartOpen ? 'is-open' : ''}`} aria-label={`Pedido ${order.orderNumber}`}>
          <div className="ticket-mobile-head">
            <span>Tu pedido</span>
            <button type="button" className="icon-button" onClick={() => setCartOpen(false)} aria-label="Cerrar pedido">
              <Icon name="close" size={22} />
            </button>
          </div>

          <div className="ticket-head">
            <div>
              <span className="eyebrow">Cuenta abierta</span>
              <h2>{cartTitle}</h2>
            </div>
            <span className="order-number">{order.orderNumber}</span>
          </div>

          <label className="customer-field">
            <span>Cliente <small>opcional</small></span>
            <input
              className="input"
              type="text"
              placeholder="Nombre del cliente"
              maxLength={100}
              value={order.customerName ?? ''}
              onChange={(event) => setCustomerName(event.target.value)}
            />
          </label>

          <div className="ticket-items">
            {order.items.length === 0 ? (
              <div className="ticket-empty">
                <span className="empty-icon">
                  <Icon name="bag" size={28} />
                </span>
                <h3>El pedido está vacío</h3>
                <p>Toca productos del menú para agregarlos.</p>
              </div>
            ) : (
              order.items.map((item) => (
                <article key={item.clientKey} className="ticket-item">
                  <div className="ticket-item-row">
                    <div className="ticket-item-name">
                      <strong>{item.productName}</strong>
                      <span>
                        {formatMoney(item.unitPriceCents)} c/u
                      </span>
                    </div>
                    <strong className="ticket-item-total">{formatMoney(item.lineTotalCents)}</strong>
                  </div>

                  {item.notes ? (
                    <p className="ticket-item-note">
                      <Icon name="note" size={14} />
                      {item.notes}
                    </p>
                  ) : null}

                  <div className="ticket-item-actions">
                    <div className="qty-stepper">
                      <button
                        type="button"
                        onClick={() => setItemQuantity(item.clientKey, item.quantity - 1)}
                        aria-label={`Quitar una unidad de ${item.productName}`}
                      >
                        <Icon name="minus" size={18} />
                      </button>
                      <span aria-label={`Cantidad ${item.quantity}`}>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => setItemQuantity(item.clientKey, item.quantity + 1)}
                        aria-label={`Agregar una unidad de ${item.productName}`}
                      >
                        <Icon name="plus" size={18} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`item-action ${noteEditor?.clientKey === item.clientKey ? 'is-active' : ''}`}
                      onClick={() => (noteEditor?.clientKey === item.clientKey ? setNoteEditor(null) : openNoteEditor(item))}
                    >
                      <Icon name="note" size={16} />
                      Nota
                    </button>
                    <button
                      type="button"
                      className="item-action item-remove"
                      onClick={() => removeItem(item.clientKey)}
                      aria-label={`Eliminar ${item.productName}`}
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </div>

                  {noteEditor?.clientKey === item.clientKey ? (
                    <div className="note-editor">
                      <label>
                        <span>Nota para cocina</span>
                        <input
                          className="input"
                          type="text"
                          maxLength={200}
                          value={noteEditor.value}
                          onChange={(event) => setNoteEditor((previous) => ({ ...previous, value: event.target.value }))}
                          placeholder="Ej. sin cebolla"
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              saveNote();
                            }
                          }}
                        />
                      </label>
                      <div className="note-quick">
                        {['Sin cebolla', 'Sin picante', 'Extra salsa', 'Sin gluten'].map((quick) => (
                          <button
                            key={quick}
                            type="button"
                            className="quick-chip quick-chip-small"
                            onClick={() => setNoteEditor((previous) => ({ ...previous, value: quick }))}
                          >
                            {quick}
                          </button>
                        ))}
                      </div>
                      <div className="note-actions">
                        <button type="button" className="btn btn-small btn-ghost" onClick={() => setNoteEditor(null)}>
                          Cancelar
                        </button>
                        <button type="button" className="btn btn-small btn-primary" onClick={saveNote}>
                          Guardar nota
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))
            )}
          </div>

          <div className="ticket-totals">
            <div className="summary-row">
              <span>Subtotal</span>
              <span>{formatMoney(order.subtotalCents)}</span>
            </div>
            <button type="button" className="summary-action-row" onClick={() => setDiscountOpen(true)}>
              <span>
                Descuento {discountText ? <em>{discountText}</em> : null}
              </span>
              <span className={order.discountCents > 0 ? 'discount-value' : 'add-value'}>
                {order.discountCents > 0 ? `-${formatMoney(order.discountCents)}` : 'Agregar'}
              </span>
            </button>
            <div className="summary-row">
              <span>Impuesto ({order.taxRateBps / 100}%)</span>
              <span>{formatMoney(order.taxCents)}</span>
            </div>
            <div className="summary-row">
              <span>Propina</span>
              <span>{order.tipCents > 0 ? formatMoney(order.tipCents) : 'Se elige al cobrar'}</span>
            </div>
            <div className="summary-row summary-total">
              <span>Total</span>
              <strong>{formatMoney(order.totalCents)}</strong>
            </div>
          </div>

          {actionError ? (
            <div className="alert alert-error ticket-alert" role="alert">
              <Icon name="alert" size={18} />
              <p>{actionError}</p>
            </div>
          ) : null}

          <div className="ticket-actions">
            <button
              type="button"
              className="btn btn-primary btn-charge"
              onClick={() => {
                setActionError('');
                setPaymentOpen(true);
              }}
              disabled={order.items.length === 0 || leaving}
            >
              <Icon name="cash" size={22} />
              Cobrar {formatMoney(order.totalCents)}
            </button>
            <button type="button" className="text-button" onClick={() => void handleExit()} disabled={leaving || saving}>
              Guardar y volver a mesas
            </button>
          </div>
        </aside>
      </div>

      <button
        type="button"
        className="mobile-cart-bar"
        onClick={() => setCartOpen(true)}
        aria-label={`Ver pedido, ${itemCount} artículos, total ${formatMoney(order.totalCents)}`}
      >
        <span className="mobile-cart-count">
          <Icon name="receipt" size={20} />
          {itemCount} {itemCount === 1 ? 'artículo' : 'artículos'}
        </span>
        <span className="mobile-cart-total">
          Ver pedido <strong>{formatMoney(order.totalCents)}</strong>
        </span>
      </button>

      <DiscountModal
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        order={order}
        onApply={setDiscount}
      />
      <PaymentModal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        order={order}
        onSetTip={setTip}
        onConfirm={handlePaymentConfirm}
      />
    </div>
  );
}
