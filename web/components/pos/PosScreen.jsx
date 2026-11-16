'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import HomeView from './HomeView';
import OrderWorkspace from './OrderWorkspace';

export default function PosScreen() {
  const [catalog, setCatalog] = useState(null);
  const [tables, setTables] = useState([]);
  const [takeawayOrders, setTakeawayOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [activeOrder, setActiveOrder] = useState(null);
  const [busyLabel, setBusyLabel] = useState('');
  const [notice, setNotice] = useState(null);
  const loadedRef = useRef(false);

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [catalogResponse, tablesResponse, ordersResponse] = await Promise.all([
        api.getCatalog(),
        api.getTables(),
        api.getOrders({ status: 'abierta', type: 'llevar', limit: 50 }),
      ]);
      setCatalog(catalogResponse);
      setTables(tablesResponse.tables);
      setTakeawayOrders(ordersResponse.orders);
      setError('');
      loadedRef.current = true;
    } catch (loadError) {
      setError(loadError?.message || 'No se pudo cargar la información del punto de venta.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const orderId = Number(new URLSearchParams(window.location.search).get('order'));
    if (!Number.isInteger(orderId) || orderId <= 0) return;
    window.history.replaceState({}, '', '/');
    api.getOrder(orderId)
      .then((response) => setActiveOrder(response.order))
      .catch((openError) => setNotice({ type: 'error', message: openError?.message || 'No se pudo abrir la cuenta.' }));
  }, []);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (activeOrder) return undefined;
    const poll = setInterval(() => void loadData({ silent: true }), 15_000);
    return () => clearInterval(poll);
  }, [activeOrder, loadData]);

  async function fetchOrder(id) {
    const response = await api.getOrder(id);
    setActiveOrder(response.order);
  }

  async function handleOpenTable(table) {
    if (busyLabel) return;
    setBusyLabel(`Abriendo ${table.name}…`);
    try {
      if (table.openOrder) {
        await fetchOrder(table.openOrder.id);
      } else {
        const response = await api.createOrder({ type: 'mesa', tableId: table.id });
        setActiveOrder(response.order);
      }
    } catch (openError) {
      if (openError?.status === 409 && openError?.details?.orderId) {
        try {
          await fetchOrder(openError.details.orderId);
          return;
        } catch {
          // El pedido reportado por el conflicto ya no existe; recargamos el salón.
        }
      }
      setNotice({ type: 'error', message: openError?.message || 'No se pudo abrir la mesa.' });
      await loadData({ silent: true });
    } finally {
      setBusyLabel('');
    }
  }

  async function handleNewTakeaway(delivery = false) {
    if (busyLabel) return;
    setBusyLabel(delivery ? 'Creando pedido de delivery…' : 'Creando pedido para llevar…');
    try {
      const response = await api.createOrder({ type: 'llevar', delivery });
      setActiveOrder(response.order);
    } catch (createError) {
      setNotice({ type: 'error', message: createError?.message || 'No se pudo crear el pedido.' });
    } finally {
      setBusyLabel('');
    }
  }

  async function handleOpenTakeaway(order) {
    if (busyLabel) return;
    setBusyLabel(`Abriendo ${order.orderNumber}…`);
    try {
      await fetchOrder(order.id);
    } catch (openError) {
      setNotice({ type: 'error', message: openError?.message || 'No se pudo abrir el pedido.' });
      await loadData({ silent: true });
    } finally {
      setBusyLabel('');
    }
  }

  async function handleOpenKitchenOrder(orderId) {
    if (busyLabel) return;
    setBusyLabel('Abriendo cuenta…');
    try {
      await fetchOrder(orderId);
    } catch (openError) {
      setNotice({ type: 'error', message: openError?.message || 'No se pudo abrir la cuenta.' });
      await loadData({ silent: true });
    } finally {
      setBusyLabel('');
    }
  }

  async function handleClosed() {
    setActiveOrder(null);
    await loadData({ silent: true });
  }

  async function handleCompleted(paidOrder) {
    setActiveOrder(null);
    setNotice({
      type: 'success',
      message: `Venta ${paidOrder.orderNumber} cobrada por ${formatMoney(paidOrder.totalCents)}.`,
    });
    await loadData({ silent: true });
  }

  if (activeOrder) {
    return (
      <>
        <OrderWorkspace
          key={`${activeOrder.id}-${activeOrder.updatedAt}`}
          initialOrder={activeOrder}
          catalog={catalog}
          onExit={handleClosed}
          onCompleted={handleCompleted}
        />
        {notice ? (
          <div className={`toast toast-${notice.type}`} role="status">
            {notice.message}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <>
      <HomeView
        tables={tables}
        onQrRefresh={() => void loadData({ silent: true })}
        takeawayOrders={takeawayOrders}
        loading={loading && !loadedRef.current}
        error={error}
        refreshing={refreshing}
        busyLabel={busyLabel}
        onRetry={() => void loadData({ silent: true })}
        onOpenTable={handleOpenTable}
        onNewTakeaway={() => handleNewTakeaway(false)}
        onNewDelivery={() => handleNewTakeaway(true)}
        onOpenTakeaway={handleOpenTakeaway}
        onOpenKitchenOrder={handleOpenKitchenOrder}
        timeZone={catalog?.timezone}
      />
      {notice ? (
        <div className={`toast toast-${notice.type}`} role="status">
          {notice.message}
        </div>
      ) : null}
    </>
  );
}
