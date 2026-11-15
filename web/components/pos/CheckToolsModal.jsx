'use client';

import { useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { formatMoney } from '@/lib/format';

export default function CheckToolsModal({ open, order, onClose, onMove, onMerge }) {
  const checks = (order.checks ?? []).filter((check) => check.status !== 'paid');
  const [sourceId, setSourceId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSourceId(String(checks[0]?.id ?? ''));
    setTargetId(String(checks[1]?.id ?? ''));
    setItemId('');
    setQuantity('1');
    setError('');
    setBusy(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = useMemo(() => (order.checks ?? []).find((check) => Number(check.id) === Number(sourceId)), [order.checks, sourceId]);
  const target = useMemo(() => (order.checks ?? []).find((check) => Number(check.id) === Number(targetId)), [order.checks, targetId]);
  const line = source?.lines.find((entry) => Number(entry.id) === Number(itemId));

  async function move() {
    if (!source || !target || !line) { setError('Selecciona cuenta origen, cuenta destino y producto.'); return; }
    const milli = Math.round((Number(quantity) || 0) * 1000);
    if (milli <= 0 || milli > Number(line.quantityMilli)) { setError('Cantidad inválida para esa línea.'); return; }
    setBusy(true); setError('');
    try { await onMove({ fromCheckId: source.id, toCheckId: target.id, orderItemId: line.orderItemId, quantityMilli: milli }); onClose(); }
    catch (e) { setError(e.message || 'No se pudo mover la línea.'); }
    finally { setBusy(false); }
  }

  async function merge() {
    if (!source || !target) { setError('Selecciona dos cuentas.'); return; }
    setBusy(true); setError('');
    try { await onMerge({ sourceCheckId: source.id, targetCheckId: target.id }); onClose(); }
    catch (e) { setError(e.message || 'No se pudieron fusionar.'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Mover o fusionar cuentas" subtitle={order.orderNumber} size="md" closeDisabled={busy}
      footer={<div className="modal-actions"><span /><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cerrar</button></div>}>
      {checks.length < 2 ? <p className="field-hint">Necesitas al menos dos cuentas abiertas.</p> : (
        <div className="form-grid">
          <label className="field"><span className="field-label">Cuenta origen</span><select className="input select" value={sourceId} onChange={(event) => { setSourceId(event.target.value); setItemId(''); }}>{checks.map((check) => <option key={check.id} value={check.id}>{check.label} · {formatMoney(check.balanceCents)}</option>)}</select></label>
          <label className="field"><span className="field-label">Cuenta destino</span><select className="input select" value={targetId} onChange={(event) => setTargetId(event.target.value)}>{checks.filter((check) => Number(check.id) !== Number(sourceId)).map((check) => <option key={check.id} value={check.id}>{check.label} · {formatMoney(check.balanceCents)}</option>)}</select></label>
          <label className="field field-full"><span className="field-label">Línea a mover</span><select className="input select" value={itemId} onChange={(event) => setItemId(event.target.value)}><option value="">Selecciona un producto</option>{(source?.lines ?? []).map((entry) => <option key={entry.id} value={entry.id}>{entry.productName} · {entry.quantity} disponibles</option>)}</select></label>
          <label className="field"><span className="field-label">Cantidad</span><input className="input" type="number" min={0.001} step={0.001} max={line ? line.quantity : undefined} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
          <div className="field check-tools-actions"><button type="button" className="btn btn-primary" onClick={() => void move()} disabled={busy || !line}><Icon name="split" size={17} /> Mover línea</button><button type="button" className="btn btn-secondary" onClick={() => void merge()} disabled={busy || !target}><Icon name="merge" size={17} /> Fusionar cuentas</button></div>
          {error ? <p className="form-error field-full">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}
