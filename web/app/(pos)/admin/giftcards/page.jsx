'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { FeatureGate } from '@/components/FeatureProvider';
import { api } from '@/lib/api';
import { centsToInput, parseMoneyToCents } from '@restpos/shared/money';
import { formatMoney } from '@/lib/format';

function GiftCardsContent() {
  const [cards, setCards] = useState([]);
  const [amount, setAmount] = useState('100.00');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const response = await api.getGiftCards(); setCards(response.giftCards ?? []); }
    catch (e) { setError(e.message || 'No se pudieron cargar las gift cards.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(event) {
    event.preventDefault();
    let amountCents;
    try { amountCents = parseMoneyToCents(amount); } catch { setError('Monto inválido.'); return; }
    if (amountCents <= 0) { setError('El monto debe ser mayor que cero.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await api.createGiftCard({ amountCents, notes: notes.trim() });
      setCards((previous) => [response.giftCard, ...previous]);
      setNotice(`Gift card ${response.giftCard.code} emitida por ${formatMoney(response.giftCard.initialCents)}.`);
      setNotes(''); setAmount('100.00');
    } catch (e) { setError(e.message || 'No se pudo emitir.'); }
    finally { setBusy(false); }
  }

  async function toggle(card) {
    try {
      const response = await api.updateGiftCard(card.id, { active: !card.active });
      setCards((previous) => previous.map((entry) => entry.id === card.id ? response.giftCard : entry));
    } catch (e) { setError(e.message || 'No se pudo actualizar.'); }
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading"><div><span className="eyebrow">Cobros</span><h1>Gift cards</h1><p>Emite tarjetas de regalo y consulta sus saldos.</p></div></div>
      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p></div> : null}
      {notice ? <div className="alert alert-success"><Icon name="check" size={19} /><p>{notice}</p></div> : null}
      <div className="gift-layout">
        <section className="panel gift-list-panel">
          <h2>Tarjetas emitidas</h2>
          {cards.length === 0 ? <div className="empty-panel"><Icon name="wallet" size={28} /><p>Sin gift cards emitidas.</p></div> : cards.map((card) => (
            <div key={card.id} className={`gift-card-row ${card.active ? '' : 'is-inactive'}`}>
              <span className="gift-code">{card.code}</span>
              <div><strong>{formatMoney(card.balanceCents)}</strong><span>de {formatMoney(card.initialCents)}{card.notes ? ` · ${card.notes}` : ''}</span></div>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => void toggle(card)}>{card.active ? 'Desactivar' : 'Activar'}</button>
            </div>
          ))}
        </section>
        <section className="panel gift-create-panel">
          <h2>Emitir gift card</h2>
          <form className="form-grid" onSubmit={create}>
            <label className="field field-full"><span className="field-label">Monto</span><div className="money-input-wrap"><span className="money-prefix">₡</span><input className="input money-input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label>
            <label className="field field-full"><span className="field-label">Notas</span><input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={300} /></label>
            <button type="submit" className="btn btn-primary field-full" disabled={busy}><Icon name="plus" size={17} /> Emitir</button>
          </form>
          <p className="field-hint">El código se genera automáticamente y se puede cobrar como método de pago.</p>
        </section>
      </div>
    </div>
  );
}

export default function GiftCardsPage() { return <FeatureGate feature="gift_cards"><GiftCardsContent /></FeatureGate>; }
