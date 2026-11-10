'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { calculateLineTotal, calculateTotals } from '@restpos/shared/pricing';
import { api } from './api';

const SAVE_DELAY_MS = 220;

function newClientKey() {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `line-${suffix}`;
}

function withTotals(order) {
  const items = order.items.map((item) => ({
    ...item,
    lineTotalCents: calculateLineTotal(item.unitPriceCents, item.quantity),
  }));
  const totals = calculateTotals({
    items,
    discountType: order.discountType,
    discountValue: order.discountValue,
    tipType: order.tipType,
    tipValue: order.tipValue,
    taxRateBps: order.taxRateBps,
  });
  return {
    ...order,
    items,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    taxCents: totals.taxCents,
    tipCents: totals.tipCents,
    totalCents: totals.totalCents,
  };
}

function toPayload(order) {
  return {
    items: order.items.map((item) => ({
      clientKey: item.clientKey,
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes ?? '',
    })),
    customerName: order.customerName ?? '',
    notes: order.notes ?? '',
    discountType: order.discountType,
    discountValue: order.discountValue,
    tipType: order.tipType,
    tipValue: order.tipValue,
  };
}

export function useDraftOrder(initialOrder) {
  const [order, setOrder] = useState(initialOrder);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [saveError, setSaveError] = useState(null);
  const orderRef = useRef(initialOrder);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const timerRef = useRef(null);
  const waitersRef = useRef([]);
  const mountedRef = useRef(true);

  const resolveWaiters = useCallback(() => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const waiter of waiters) waiter.resolve(orderRef.current);
  }, []);

  const rejectWaiters = useCallback((error) => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    for (const waiter of waiters) waiter.reject(error);
  }, []);

  const runSaveLoop = useCallback(async () => {
    if (!mountedRef.current) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current) {
      resolveWaiters();
      return;
    }
    if (savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setSaveStatus('saving');
    let failure = null;

    try {
      while (dirtyRef.current) {
        dirtyRef.current = false;
        const snapshot = orderRef.current;
        const result = await api.updateDraft(snapshot.id, toPayload(snapshot));
        if (!mountedRef.current) return;
        if (!dirtyRef.current) {
          orderRef.current = result.order;
          setOrder(result.order);
          setSaveError(null);
          setSaveStatus('saved');
        }
      }
    } catch (error) {
      failure = error;
      dirtyRef.current = true;
      if (mountedRef.current) {
        setSaveError(error?.message || 'No se pudo guardar el pedido.');
        setSaveStatus('error');
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
      if (failure) {
        rejectWaiters(failure);
      } else if (!dirtyRef.current) {
        resolveWaiters();
        if (mountedRef.current) setSaveStatus('saved');
      }
    }
  }, [resolveWaiters, rejectWaiters]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSaveLoop();
    }, SAVE_DELAY_MS);
  }, [runSaveLoop]);

  const commit = useCallback((updater) => {
    try {
      const next = withTotals(updater(orderRef.current));
      orderRef.current = next;
      setOrder(next);
      dirtyRef.current = true;
      setSaveError(null);
      setSaveStatus('pending');
      scheduleSave();
      return next;
    } catch (error) {
      setSaveError(error?.message || 'No se pudo actualizar el pedido.');
      setSaveStatus('error');
      return null;
    }
  }, [scheduleSave]);

  const addProduct = useCallback((product, notes = '') => {
    if (!product.active) return false;
    const cleanNotes = notes.trim();
    const current = orderRef.current;
    const existing = current.items.find(
      (item) => item.productId === product.id && item.notes.trim() === cleanNotes,
    );
    if (existing && existing.quantity >= 99) return false;

    const items = existing
      ? current.items.map((item) =>
          item.clientKey === existing.clientKey
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        )
      : [
          ...current.items,
          {
            id: null,
            clientKey: newClientKey(),
            productId: product.id,
            productName: product.name,
            unitPriceCents: product.priceCents,
            quantity: 1,
            notes: cleanNotes,
            lineTotalCents: product.priceCents,
          },
        ];
    commit((previous) => ({ ...previous, items }));
    return true;
  }, [commit]);

  const setItemQuantity = useCallback((clientKey, quantity) => {
    commit((previous) => {
      if (quantity < 1) {
        return { ...previous, items: previous.items.filter((item) => item.clientKey !== clientKey) };
      }
      const safeQuantity = Math.min(99, Math.floor(quantity));
      return {
        ...previous,
        items: previous.items.map((item) =>
          item.clientKey === clientKey ? { ...item, quantity: safeQuantity } : item,
        ),
      };
    });
  }, [commit]);

  const removeItem = useCallback((clientKey) => {
    commit((previous) => ({
      ...previous,
      items: previous.items.filter((item) => item.clientKey !== clientKey),
    }));
  }, [commit]);

  const setItemNotes = useCallback((clientKey, notes) => {
    commit((previous) => ({
      ...previous,
      items: previous.items.map((item) =>
        item.clientKey === clientKey ? { ...item, notes: notes.slice(0, 200) } : item,
      ),
    }));
  }, [commit]);

  const setDiscount = useCallback((discountType, discountValue) => {
    commit((previous) => ({
      ...previous,
      discountType,
      discountValue: discountType === 'none' ? 0 : discountValue,
    }));
  }, [commit]);

  const setTip = useCallback((tipType, tipValue) => {
    commit((previous) => ({
      ...previous,
      tipType,
      tipValue: tipType === 'none' ? 0 : tipValue,
    }));
  }, [commit]);

  const setCustomerName = useCallback((customerName) => {
    commit((previous) => ({ ...previous, customerName: customerName.slice(0, 100) }));
  }, [commit]);

  const setOrderNotes = useCallback((notes) => {
    commit((previous) => ({ ...previous, notes: notes.slice(0, 500) }));
  }, [commit]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!dirtyRef.current && !savingRef.current) {
      return Promise.resolve(orderRef.current);
    }
    return new Promise((resolve, reject) => {
      waitersRef.current.push({ resolve, reject });
      if (!savingRef.current) void runSaveLoop();
    });
  }, [runSaveLoop]);

  const retrySave = useCallback(() => {
    setSaveError(null);
    setSaveStatus('pending');
    dirtyRef.current = true;
    return flush();
  }, [flush]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      rejectWaiters(new Error('El pedido se cerró antes de terminar de guardar.'));
    };
  }, [rejectWaiters]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!dirtyRef.current && !savingRef.current) return undefined;
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  return {
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
    setOrderNotes,
    flush,
    retrySave,
  };
}
