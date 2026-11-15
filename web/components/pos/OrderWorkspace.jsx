'use client';

import { useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { formatPercentBps } from '@restpos/shared/money';
import { api } from '@/lib/api';
import { formatMoney, paymentLabel, productQtyInOrder, serviceLabel, serviceShortLabel } from '@/lib/format';
import { useDraftOrder } from '@/lib/useDraftOrder';
import DiscountModal from './DiscountModal';
import PaymentModal from './PaymentModal';
import ProductModifierModal from './ProductModifierModal';
import SplitBillModal from './SplitBillModal';
import TableOpsModal from './TableOpsModal';
import ShareWhatsAppButton from '@/components/ShareWhatsAppButton';
import { useAuth } from '@/components/auth/AuthProvider';
import { useFeatures } from '@/components/FeatureProvider';

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
  const { enabled } = useFeatures();
  const [openingReceipt, setOpeningReceipt] = useState(false);
  const [printerMode, setPrinterMode] = useState({ enabled: false, connection: 'network' });
  useEffect(() => {
    api.getFeatures().then((response) => setPrinterMode({
      enabled: response.features?.printer_enabled === 'true',
      connection: response.features?.printer_connection || 'network',
    })).catch(() => {});
  }, []);

  const paymentNames = [...new Set((order.payments ?? []).map((payment) => payment.paymentMethodName || paymentLabel(payment.paymentMethod)))];
  const paymentText = paymentNames.length > 1
    ? `Pago mixto · ${paymentNames.join(' + ')}`
    : (paymentNames[0] || paymentLabel(order.paymentMethod));
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState('');

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
          {order.orderNumber} · {serviceLabel(order)} ·{' '}
          {paymentText}
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
            <strong>{paymentText}</strong>
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
          {enabled('browser_printing') ? (
            <button type="button" className="btn btn-secondary btn-large" onClick={() => openReceipt(true)} disabled={openingReceipt}>
              <Icon name="printer" size={21} />
              Imprimir ticket
            </button>
          ) : null}
          {printerMode.enabled && printerMode.connection === 'network' ? (
            <button type="button" className="btn btn-secondary btn-large" onClick={async () => {
              setPrinting(true);
              setPrintError('');
              try { await api.printOrder(order.id, 'receipt'); } catch (error) { setPrintError(error.message); } finally { setPrinting(false); }
            }} disabled={printing}>
              {printing ? <span className="spinner spinner-small" /> : <Icon name="receipt" size={21} />}
              Imprimir térmica
            </button>
          ) : null}
          <ShareWhatsAppButton orderId={order.id} className="btn btn-secondary btn-large" />
          <button type="button" className="btn btn-primary btn-large" onClick={() => onNewOrder(order)}>
            <Icon name="plus" size={21} />
            Nuevo pedido
          </button>
        </div>
        {order.photoUploadError ? <p className="form-error">{order.photoUploadError}</p> : null}
        {printError ? <p className="form-error">{printError}</p> : null}
        {enabled('browser_printing') ? (
          <button type="button" className="text-button" onClick={() => openReceipt(false)}>
            Solo ver el ticket
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function OrderWorkspace({ initialOrder, catalog, onExit, onCompleted }) {
  const { staff } = useAuth();
  const { enabled } = useFeatures();
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
    setCustomerPhone,
    setDeliveryAddress,
    setOrderNotes,
    flush,
    retrySave,
    applyServerOrder,
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
  const [modifierProduct, setModifierProduct] = useState(null);
  const [sendingKitchen, setSendingKitchen] = useState(false);
  const [kitchenNotice, setKitchenNotice] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [courtesyOpen, setCourtesyOpen] = useState(false);
  const [courtesyReason, setCourtesyReason] = useState('');
  const [courtesyError, setCourtesyError] = useState('');
  const [closingCourtesy, setClosingCourtesy] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitTarget, setSplitTarget] = useState(null);
  const [splitNotice, setSplitNotice] = useState('');
  const [tableOpsOpen, setTableOpsOpen] = useState(false);

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
  const pendingCount = order.items.reduce((sum, item) => {
    const sent = item.status === 'pending' ? 0 : Number(item.sentQuantity ?? item.quantity);
    return sum + (item.status === 'pending' ? item.quantity : Math.max(0, item.quantity - sent));
  }, 0);
  const paidCents = Number(order.amountPaidCents ?? 0);
  const balanceCents = Math.max(0, Number(order.totalCents) - paidCents);
  const locked = paidCents > 0;
  const deliveryIncomplete = order.delivery && (!order.customerPhone?.trim() || !order.deliveryAddress?.trim());
  const canCourtesy = ['owner', 'admin', 'manager'].includes(staff?.role);
  const isCourtesy = order.totalCents === 0 && order.items.length > 0 && paidCents === 0;
  const cartTitle = order.type === 'mesa' ? order.tableName : order.delivery ? 'Delivery' : 'Para llevar';

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
          if (disabled || locked) return;
          if ((product.modifierGroups ?? []).length > 0) setModifierProduct(product);
          else addProduct(product);
        }}
        disabled={disabled || locked}
        aria-label={`${product.name}, ${formatMoney(product.priceCents)}${disabled ? ', no disponible' : '. Agregar al pedido.'}`}
      >
        {product.imageUrl ? (
          <span className="product-image"><img src={product.imageUrl} alt="" loading="lazy" /></span>
        ) : null}
        <div className="product-card-heading">
          {search.trim() || categoryId === 'all' ? <span className="product-category">{product.categoryName}</span> : null}
          <h3>{product.name}</h3>
          {product.description ? <p>{product.description}</p> : null}
          {(product.modifierGroups ?? []).length > 0 ? (
            <span className="product-options-hint"><Icon name="sliders" size={13} /> Personalizable</span>
          ) : null}
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

  async function handleClearSplits() {
    if (paidCents > 0) return;
    try {
      const response = await api.clearSplits(order.id);
      applyServerOrder(response.order);
      setSplitNotice('');
    } catch (error) {
      setActionError(error.message || 'No se pudo deshacer la división.');
    }
  }

  async function handleSplitSave(groups) {
    await flush();
    const response = await api.splitOrder(order.id, { groups });
    applyServerOrder(response.order);
    setSplitNotice('Cuenta dividida. Cobra cada parte por separado.');
    return response;
  }

  async function handlePaymentConfirm(payload) {
    const { photos = [], splitId = null, ...payment } = payload;
    await flush();
    let response = await api.payOrder(order.id, { ...payment, ...(splitId ? { splitId } : {}) });
    let photoUploadError = '';
    if (photos.length > 0) {
      const paymentId = response.order.payments?.at(-1)?.id;
      if (paymentId) {
        try {
          await api.uploadPaymentPhotos(order.id, paymentId, photos);
          response = await api.getOrder(order.id);
        } catch (uploadError) {
          photoUploadError = uploadError.message || 'El pago se registró, pero no se pudo adjuntar el comprobante.';
        }
      }
    }
    const updatedOrder = { ...response.order, photoUploadError };
    if (updatedOrder.status === 'pagada') {
      setPaidOrder(updatedOrder);
      setPaymentOpen(false);
      setCartOpen(false);
    } else {
      applyServerOrder(updatedOrder);
      if (splitId) {
        setPaymentOpen(false);
        setSplitTarget(null);
        setSplitNotice('Parte cobrada. Continúa con la siguiente.');
      }
    }
    return updatedOrder;
  }

  async function handleCourtesyClose() {
    if (courtesyReason.trim().length < 3) {
      setCourtesyError('Indica el motivo de la cortesía.');
      return;
    }
    setClosingCourtesy(true);
    setCourtesyError('');
    try {
      await flush();
      const response = await api.closeCourtesy(order.id, { reason: courtesyReason.trim() });
      setPaidOrder(response.order);
      setCourtesyOpen(false);
      setPaymentOpen(false);
      setCartOpen(false);
    } catch (error) {
      setCourtesyError(error.message || 'No se pudo cerrar la cortesía.');
    } finally {
      setClosingCourtesy(false);
    }
  }

  async function handleCancelOrder() {
    setCancelling(true);
    setActionError('');
    try {
      await api.cancelOrder(order.id);
      setCancelOpen(false);
      onExit();
    } catch (error) {
      setActionError(error.message || 'No se pudo anular el pedido.');
    } finally {
      setCancelling(false);
    }
  }

  async function handleSendKitchen() {
    if (sendingKitchen || pendingCount === 0) return;
    setSendingKitchen(true);
    setActionError('');
    setKitchenNotice('');
    try {
      await flush();
      const response = await api.sendToKitchen(order.id);
      applyServerOrder(response.order);
      window.dispatchEvent(new CustomEvent('restpos:kitchen-changed'));
      setKitchenNotice(
        response.printWarning
          ? `Comanda enviada. Impresión pendiente: ${response.printWarning}`
          : 'Comanda enviada a cocina.',
      );
    } catch (error) {
      setActionError(error.message || 'No se pudo enviar la comanda.');
    } finally {
      setSendingKitchen(false);
    }
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
            {order.type === 'mesa' ? 'Pedido en mesa' : order.delivery ? 'Pedido delivery' : 'Pedido para llevar'} · {order.orderNumber}
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

          <div className="ticket-scroll">
            <div className="ticket-head">
            <div>
              <span className="eyebrow">Cuenta abierta</span>
              <div className="ticket-title-row">
                <h2>{cartTitle}</h2>
                <span className={`service-badge service-${order.serviceType}`}>{serviceShortLabel(order)}</span>
              </div>
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
              disabled={locked}
            />
          </label>
          <label className="customer-field order-notes-field">
            <span>Notas del pedido <small>opcional</small></span>
            <input
              className="input"
              type="text"
              placeholder="Ej. cumpleaños, servir juntos…"
              maxLength={500}
              value={order.notes ?? ''}
              onChange={(event) => setOrderNotes(event.target.value)}
              disabled={locked}
            />
          </label>
          {order.delivery ? (
            <div className="delivery-fields">
              <label className="field">
                <span className="field-label">Teléfono</span>
                <input
                  className="input"
                  type="tel"
                  placeholder="Teléfono del cliente"
                  maxLength={30}
                  value={order.customerPhone ?? ''}
                  onChange={(event) => setCustomerPhone(event.target.value)}
                  disabled={locked}
                />
              </label>
              <label className="field">
                <span className="field-label">Dirección de entrega</span>
                <input
                  className="input"
                  type="text"
                  placeholder="Calle, número, colonia y referencias"
                  maxLength={300}
                  value={order.deliveryAddress ?? ''}
                  onChange={(event) => setDeliveryAddress(event.target.value)}
                  disabled={locked}
                />
              </label>
            </div>
          ) : order.customerPhone ? (
            <div className="customer-extra"><span><Icon name="phone" size={14} /> {order.customerPhone}</span></div>
          ) : null}
          {locked ? (
            <div className="ticket-lock-note"><Icon name="lock" size={15} /> Cuenta bloqueada por un pago parcial. Cobra el saldo para cerrarla.</div>
          ) : null}

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

                  {(item.modifiers ?? []).length > 0 ? (
                    <p className="ticket-item-modifiers">
                      {item.modifiers.map((modifier) => modifier.modifierName).join(' · ')}
                    </p>
                  ) : null}

                  {item.notes ? (
                    <p className="ticket-item-note">
                      <Icon name="note" size={14} />
                      {item.notes}
                    </p>
                  ) : null}

                  <div className="ticket-item-meta">
                    {item.status === 'pending' ? <span className="item-status is-pending">Por enviar</span> : null}
                    {item.status === 'sent' ? <span className="item-status is-sent">En cocina</span> : null}
                    {item.status === 'preparing' ? <span className="item-status is-preparing">Preparando</span> : null}
                    {item.status === 'ready' ? <span className="item-status is-ready">Listo para servir</span> : null}
                    {item.status === 'served' ? <span className="item-status is-served">Servido</span> : null}
                  </div>

                  <div className="ticket-item-actions">
                    <div className="qty-stepper">
                      <button
                        type="button"
                        onClick={() => setItemQuantity(item.clientKey, item.quantity - 1)}
                        aria-label={`Quitar una unidad de ${item.productName}`}
                        disabled={locked}
                      >
                        <Icon name="minus" size={18} />
                      </button>
                      <span aria-label={`Cantidad ${item.quantity}`}>{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => setItemQuantity(item.clientKey, item.quantity + 1)}
                        aria-label={`Agregar una unidad de ${item.productName}`}
                        disabled={locked}
                      >
                        <Icon name="plus" size={18} />
                      </button>
                    </div>
                    <button
                      type="button"
                      className={`item-action ${noteEditor?.clientKey === item.clientKey ? 'is-active' : ''}`}
                      onClick={() => (noteEditor?.clientKey === item.clientKey ? setNoteEditor(null) : openNoteEditor(item))}
                      disabled={locked}
                    >
                      <Icon name="note" size={16} />
                      Nota
                    </button>
                    <button
                      type="button"
                      className="item-action item-remove"
                      onClick={() => removeItem(item.clientKey)}
                      aria-label={`Eliminar ${item.productName}`}
                      disabled={locked}
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

          {order.splits?.length > 0 ? (
            <div className="split-summary">
              <div className="split-summary-head"><strong>Cuenta dividida</strong><span>{order.splits.filter((split) => split.status === 'paid').length} / {order.splits.length} pagadas</span></div>
              {paidCents === 0 ? <button type="button" className="text-button split-undo" onClick={() => void handleClearSplits()}>Deshacer división</button> : null}
              {order.splits.map((split, index) => (
                <div key={split.id} className={`split-row ${split.status === 'paid' ? 'is-paid' : ''}`}>
                  <div><strong>{split.label || `Parte ${index + 1}`}</strong><span>{split.items.length} producto(s) · {formatMoney(split.totalCents)}</span></div>
                  {split.status === 'paid' ? (
                    <span className="item-status is-served">Pagada</span>
                  ) : (
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => { setSplitTarget(split); setPaymentOpen(true); }} disabled={leaving || split.status === 'paid'}>
                      Cobrar {formatMoney(split.balanceCents)}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {splitNotice ? <div className="alert alert-success ticket-alert"><Icon name="check" size={18} /><p>{splitNotice}</p></div> : null}

          <div className="ticket-totals">
            <div className="summary-row">
              <span>Subtotal</span>
              <span>{formatMoney(order.subtotalCents)}</span>
            </div>
            <button type="button" className="summary-action-row" onClick={() => setDiscountOpen(true)} disabled={locked}>
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
            {order.deliveryFeeCents > 0 ? (
              <div className="summary-row">
                <span>Costo de entrega</span>
                <span>{formatMoney(order.deliveryFeeCents)}</span>
              </div>
            ) : null}
            <div className="summary-row">
              <span>Propina</span>
              <span>{order.tipCents > 0 ? formatMoney(order.tipCents) : 'Se elige al cobrar'}</span>
            </div>
            {paidCents > 0 ? (
              <>
                <div className="summary-row">
                  <span>Pagado</span>
                  <span>{formatMoney(paidCents)}</span>
                </div>
                <div className="summary-row summary-balance">
                  <span>Saldo</span>
                  <span>{formatMoney(balanceCents)}</span>
                </div>
              </>
            ) : null}
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
          {kitchenNotice ? (
            <div className="alert alert-success ticket-alert" role="status">
              <Icon name="check" size={18} />
              <p>{kitchenNotice}</p>
            </div>
          ) : null}
          </div>

          <div className="ticket-actions">
            {deliveryIncomplete ? (
              <p className="delivery-required"><Icon name="alert" size={15} /> Captura teléfono y dirección para cobrar el delivery.</p>
            ) : null}
            {pendingCount > 0 ? (
              <button type="button" className="btn btn-secondary btn-send-kitchen" onClick={() => void handleSendKitchen()} disabled={sendingKitchen || leaving}>
                {sendingKitchen ? <span className="spinner spinner-small" /> : <Icon name="send" size={19} />}
                Enviar a cocina · {pendingCount}
              </button>
            ) : null}
            {enabled('split_bill') && (order.splits?.length ?? 0) === 0 && order.items.length >= 2 && paidCents === 0 && order.discountCents === 0 && order.tipCents === 0 ? (
              <button type="button" className="btn btn-secondary" onClick={() => setSplitOpen(true)} disabled={leaving || saving}>
                <Icon name="split" size={19} />
                Dividir cuenta
              </button>
            ) : null}
            {order.splits?.length > 0 ? null : isCourtesy && canCourtesy ? (
              <button
                type="button"
                className="btn btn-primary btn-charge"
                onClick={() => {
                  setCourtesyError('');
                  setCourtesyReason(order.discountReason ?? '');
                  setCourtesyOpen(true);
                }}
                disabled={leaving}
              >
                <Icon name="gift" size={22} />
                Cerrar cortesía · {formatMoney(0)}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-charge"
                onClick={() => {
                  setActionError('');
                  setPaymentOpen(true);
                }}
                disabled={order.items.length === 0 || leaving || deliveryIncomplete || order.totalCents === 0}
              >
                <Icon name="cash" size={22} />
                {paidCents > 0 ? `Cobrar saldo ${formatMoney(balanceCents)}` : `Cobrar ${formatMoney(order.totalCents)}`}
              </button>
            )}
            {enabled('table_transfer_merge') ? (
              <button type="button" className="text-button" onClick={() => setTableOpsOpen(true)} disabled={leaving || saving}>
                Mover o unir pedido
              </button>
            ) : null}
            <button type="button" className="text-button" onClick={() => void handleExit()} disabled={leaving || saving}>
              Guardar y volver a mesas
            </button>
            {['admin', 'manager'].includes(staff?.role) && paidCents === 0 ? (
              <button type="button" className="text-button text-danger cancel-order-link" onClick={() => setCancelOpen(true)} disabled={leaving || saving}>
                Anular pedido
              </button>
            ) : null}
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

      <Modal
        open={courtesyOpen}
        onClose={() => setCourtesyOpen(false)}
        title="Cerrar cortesía"
        subtitle={`${order.orderNumber} · ${cartTitle}`}
        size="sm"
        closeDisabled={closingCourtesy}
        footer={
          <div className="modal-actions">
            <span />
            <div className="modal-actions-right">
              <button type="button" className="btn btn-secondary" onClick={() => setCourtesyOpen(false)} disabled={closingCourtesy}>Cancelar</button>
              <button type="button" className="btn btn-primary" onClick={() => void handleCourtesyClose()} disabled={closingCourtesy}>
                {closingCourtesy ? <span className="spinner spinner-small" /> : <Icon name="gift" size={18} />}
                Cerrar cortesía
              </button>
            </div>
          </div>
        }
      >
        <p className="confirm-copy">El pedido se cerrará con total cero y quedará registrado en auditoría como cortesía. No se registrará un cobro.</p>
        <label className="field">
          <span className="field-label">Motivo de la cortesía</span>
          <textarea
            className="input"
            rows={2}
            maxLength={200}
            value={courtesyReason}
            onChange={(event) => { setCourtesyReason(event.target.value); setCourtesyError(''); }}
            placeholder="Ej. cortesía autorizada por gerencia"
            autoFocus
          />
        </label>
        {courtesyError ? <p className="form-error">{courtesyError}</p> : null}
      </Modal>

      <TableOpsModal
        open={tableOpsOpen}
        order={order}
        onClose={() => setTableOpsOpen(false)}
        onDone={async (updatedOrder) => { applyServerOrder(updatedOrder); if (updatedOrder.status === 'anulada') { onExit(); return; } setSplitNotice('Pedido actualizado.'); }}
      />
      <SplitBillModal
        open={splitOpen}
        order={order}
        onClose={() => setSplitOpen(false)}
        onSave={handleSplitSave}
      />
      <DiscountModal
        open={discountOpen}
        onClose={() => setDiscountOpen(false)}
        order={order}
        onApply={setDiscount}
        staffRole={staff?.role}
      />
      <PaymentModal
        open={paymentOpen}
        onClose={() => { setPaymentOpen(false); setSplitTarget(null); }}
        order={order}
        split={splitTarget}
        onSetTip={setTip}
        onConfirm={handlePaymentConfirm}
        onRefresh={async () => {
          const response = await api.getOrder(order.id);
          applyServerOrder(response.order);
        }}
      />
      <ProductModifierModal
        open={Boolean(modifierProduct)}
        product={modifierProduct}
        onClose={() => setModifierProduct(null)}
        onAdd={(product, notes, modifiers) => addProduct(product, notes, modifiers)}
      />
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Anular pedido"
        subtitle={`${order.orderNumber} · ${cartTitle}`}
        size="sm"
        closeDisabled={cancelling}
        footer={
          <div className="modal-actions">
            <span />
            <div className="modal-actions-right">
              <button type="button" className="btn btn-secondary" onClick={() => setCancelOpen(false)} disabled={cancelling}>Conservar pedido</button>
              <button type="button" className="btn btn-danger" onClick={() => void handleCancelOrder()} disabled={cancelling}>
                {cancelling ? <span className="spinner spinner-small" /> : <Icon name="trash" size={18} />}
                Anular definitivamente
              </button>
            </div>
          </div>
        }
      >
        <p className="confirm-copy">Se anulará el pedido completo y se liberará la mesa. Esta acción queda registrada en auditoría y no se puede deshacer.</p>
      </Modal>
    </div>
  );
}
