'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { FeatureGate } from '@/components/FeatureProvider';
import { api } from '@/lib/api';
import { formatPercentBps, parseMoneyToCents, parsePercentToBps } from '@restpos/shared/money';
import { formatMoney } from '@/lib/format';

function PromotionsContent() {
  const [promotions, setPromotions] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', type: 'percent', value: '10', minSubtotal: '0.00', maxUses: '0' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const response = await api.getPromotions(); setPromotions(response.promotions ?? []); }
    catch (e) { setError(e.message || 'No se pudieron cargar las promociones.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(event) {
    event.preventDefault();
    let value; let minSubtotalCents;
    try {
      value = form.type === 'percent' ? parsePercentToBps(form.value) : parseMoneyToCents(form.value);
      minSubtotalCents = parseMoneyToCents(form.minSubtotal || '0');
    } catch (parseError) { setError(parseError.message); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await api.createPromotion({ code: form.code.trim().toUpperCase(), name: form.name.trim(), type: form.type, value, minSubtotalCents, maxUses: Number(form.maxUses) || 0 });
      setPromotions((previous) => [response.promotion, ...previous]);
      setNotice(`Cupón ${response.promotion.code} creado.`);
      setForm({ code: '', name: '', type: 'percent', value: '10', minSubtotal: '0.00', maxUses: '0' });
    } catch (e) { setError(e.message || 'No se pudo crear el cupón.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading"><div><span className="eyebrow">Promociones</span><h1>Cupones</h1><p>Códigos de descuento con mínimo de compra y límite de usos.</p></div></div>
      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p></div> : null}
      {notice ? <div className="alert alert-success"><Icon name="check" size={19} /><p>{notice}</p></div> : null}
      <div className="promo-layout">
        <section className="panel promo-list-panel">
          <h2>Cupones</h2>
          {promotions.length === 0 ? <div className="empty-panel"><Icon name="tag" size={28} /><p>Sin cupones creados.</p></div> : promotions.map((promo) => (
            <div key={promo.id} className={`promo-row ${promo.active ? '' : 'is-inactive'}`}>
              <span className="promo-code">{promo.code}</span>
              <div><strong>{promo.name}</strong><span>{promo.type === 'percent' ? formatPercentBps(promo.value) : formatMoney(promo.value)} · mínimo {formatMoney(promo.minSubtotalCents)} · {promo.uses}{promo.maxUses ? `/${promo.maxUses}` : ''} usos</span></div>
              <span className={`status-badge ${promo.active ? 'is-active' : 'is-inactive'}`}>{promo.active ? 'Activo' : 'Inactivo'}</span>
            </div>
          ))}
        </section>
        <section className="panel promo-create-panel">
          <h2>Nuevo cupón</h2>
          <form className="form-grid" onSubmit={create}>
            <label className="field field-full"><span className="field-label">Código</span><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} maxLength={40} placeholder="BIENVENIDO10" /></label>
            <label className="field field-full"><span className="field-label">Nombre</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} /></label>
            <label className="field"><span className="field-label">Tipo</span><select className="input select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}><option value="percent">Porcentaje</option><option value="fixed">Monto fijo</option></select></label>
            <label className="field"><span className="field-label">Valor</span><input className="input" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></label>
            <label className="field"><span className="field-label">Mínimo de compra</span><div className="money-input-wrap"><span className="money-prefix">₡</span><input className="input money-input" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} /></div></label>
            <label className="field"><span className="field-label">Máximo de usos</span><input className="input" type="number" min={0} value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} /></label>
            <button type="submit" className="btn btn-primary field-full" disabled={busy}><Icon name="plus" size={17} /> Crear cupón</button>
          </form>
        </section>
      </div>
    </div>
  );
}

export default function PromotionsPage() { return <FeatureGate feature="promotions"><PromotionsContent /></FeatureGate>; }
