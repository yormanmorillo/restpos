'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { formatMoney, formatTime, serviceLabel } from '@/lib/format';

export default function TableOpsModal({ open, order, onClose, onDone }) {
  const [tables, setTables] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tableId, setTableId] = useState('');
  const [sourceOrderId, setSourceOrderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    Promise.all([api.getTables(), api.getOrders({ status: 'abierta', limit: 100 })])
      .then(([tablesResponse, ordersResponse]) => {
        setTables(tablesResponse.tables ?? []);
        setOrders((ordersResponse.orders ?? []).filter((entry) => entry.id !== order.id));
        setTableId('');
        setSourceOrderId('');
      })
      .catch((loadError) => setError(loadError.message || 'No se pudieron cargar las mesas.'))
      .finally(() => setLoading(false));
  }, [open, order.id]);

  async function move() {
    if (!tableId) return;
    setBusy(true); setError('');
    try {
      const response = await api.moveOrder(order.id, Number(tableId));
      await onDone(response.order);
      onClose();
    } catch (moveError) { setError(moveError.message || 'No se pudo mover la mesa.'); }
    finally { setBusy(false); }
  }

  async function merge(sourceId = sourceOrderId) {
    if (!sourceId) return;
    setBusy(true); setError('');
    try {
      const response = await api.mergeOrder(order.id, Number(sourceId));
      await onDone(response.order);
      onClose();
    } catch (mergeError) { setError(mergeError.message || 'No se pudo unir el pedido.'); }
    finally { setBusy(false); }
  }

  const freeTables = tables.filter((table) => table.status === 'libre' && table.active);

  return (
    <Modal open={open} onClose={onClose} title="Mover o unir" subtitle={order.orderNumber} size="md" closeDisabled={busy}
      footer={<div className="modal-actions"><span /><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cerrar</button></div>}>
      {loading ? <div className="app-loading"><span className="spinner" /> Cargando mesas…</div> : (
        <div className="table-ops">
          {order.type === 'mesa' ? (
            <section>
              <h3>Mover a otra mesa</h3>
              <div className="inline-action">
                <select className="input select" value={tableId} onChange={(event) => setTableId(event.target.value)}>
                  <option value="">Selecciona una mesa libre…</option>
                  {freeTables.map((table) => <option key={table.id} value={table.id}>{table.name} · {table.capacity} personas</option>)}
                </select>
                <button type="button" className="btn btn-primary" onClick={() => void move()} disabled={!tableId || busy}>Mover</button>
              </div>
            </section>
          ) : null}
          <section>
            <h3>Unir otro pedido a esta cuenta</h3>
            {orders.length === 0 ? <p className="field-hint">No hay otros pedidos abiertos para unir.</p> : (
              <div className="table-op-order-list">
                {orders.map((entry) => (
                  <div key={entry.id} className="table-op-order-row">
                    <div><strong>{entry.orderNumber} · {serviceLabel(entry)}</strong><span>{entry.itemCount} artículos · {formatMoney(entry.totalCents)} · {formatTime(entry.createdAt)}</span></div>
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => { setSourceOrderId(entry.id); void merge(entry.id); }} disabled={busy}>
                      Unir aquí
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}
