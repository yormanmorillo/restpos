'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { FeatureGate } from '@/components/FeatureProvider';
import { api } from '@/lib/api';

const STATUS_LABELS = { pending: 'Pendiente', confirmed: 'Confirmada', seated: 'Sentada', cancelled: 'Cancelada', no_show: 'No llegó' };

function ReservationModal({ open, onClose, date, onSave }) {
  const [form, setForm] = useState({ name: '', phone: '', partySize: '2', time: '19:00', notes: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({ name: '', phone: '', partySize: '2', time: '19:00', notes: '' }); setError(''); setBusy(false);
  }, [open]);
  async function submit(event) {
    event.preventDefault();
    if (!form.name.trim()) { setError('El nombre es obligatorio.'); return; }
    setBusy(true); setError('');
    try { await onSave({ ...form, partySize: Number(form.partySize) || 1, date }); onClose(); }
    catch (e) { setError(e.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Nueva reserva" subtitle={date} size="sm" closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="reservation-form" className="btn btn-primary" disabled={busy}>Guardar</button></div></div>}>
      <form id="reservation-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full"><span className="field-label">Nombre</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={100} autoFocus /></label>
        <label className="field"><span className="field-label">Teléfono</span><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={30} /></label>
        <label className="field"><span className="field-label">Personas</span><input className="input" type="number" min={1} max={50} value={form.partySize} onChange={(e) => setForm({ ...form, partySize: e.target.value })} /></label>
        <label className="field"><span className="field-label">Hora</span><input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label>
        <label className="field field-full"><span className="field-label">Notas</span><input className="input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} /></label>
        {error ? <p className="form-error field-full">{error}</p> : null}
      </form>
    </Modal>
  );
}

function ReservationsContent() {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [reservations, setReservations] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [tab, setTab] = useState('reservations');
  const [modalOpen, setModalOpen] = useState(false);
  const [waitForm, setWaitForm] = useState({ name: '', phone: '', partySize: '2', quotedMinutes: '15' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [reservationsResponse, waitlistResponse] = await Promise.all([api.getReservations(date), api.getWaitlist()]);
      setReservations(reservationsResponse.reservations ?? []);
      setWaitlist(waitlistResponse.entries ?? []);
      setError('');
    } catch (e) { setError(e.message || 'No se pudieron cargar las reservas.'); }
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  async function saveReservation(payload) {
    const response = await api.createReservation(payload);
    setReservations((previous) => [...previous, response.reservation].sort((a, b) => a.time.localeCompare(b.time)));
  }
  async function changeStatus(reservation, status) {
    const response = await api.updateReservation(reservation.id, { status });
    setReservations((previous) => previous.map((entry) => entry.id === reservation.id ? response.reservation : entry));
  }
  async function addWait(event) {
    event.preventDefault();
    if (!waitForm.name.trim()) { setError('El nombre es obligatorio.'); return; }
    try {
      const response = await api.createWaitlistEntry({ ...waitForm, partySize: Number(waitForm.partySize) || 1, quotedMinutes: Number(waitForm.quotedMinutes) || 0 });
      setWaitlist((previous) => [...previous, response.entry]);
      setWaitForm({ name: '', phone: '', partySize: '2', quotedMinutes: '15' });
    } catch (e) { setError(e.message || 'No se pudo agregar.'); }
  }
  async function changeWait(entry, status) {
    const response = await api.updateWaitlistEntry(entry.id, status);
    setWaitlist((previous) => status === 'waiting' ? previous.map((item) => item.id === entry.id ? response.entry : item) : previous.filter((item) => item.id !== entry.id));
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading"><div><span className="eyebrow">Salón</span><h1>Reservas y lista de espera</h1><p>Agenda del día y clientes esperando mesa.</p></div><div className="heading-actions"><input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} /><button type="button" className="btn btn-primary" onClick={() => setModalOpen(true)}><Icon name="plus" size={18} /> Nueva reserva</button></div></div>
      {error ? <div className="alert alert-error"><Icon name="alert" size={18} /><p>{error}</p></div> : null}
      <div className="admin-tabs"><button type="button" className={`admin-tab ${tab === 'reservations' ? 'is-active' : ''}`} onClick={() => setTab('reservations')}><Icon name="clock" size={18} /> Reservas <span className="tab-count">{reservations.length}</span></button><button type="button" className={`admin-tab ${tab === 'waitlist' ? 'is-active' : ''}`} onClick={() => setTab('waitlist')}><Icon name="users" size={18} /> En espera <span className="tab-count">{waitlist.length}</span></button></div>
      {tab === 'reservations' ? (
        <section className="panel reservation-panel">
          {reservations.length === 0 ? <div className="empty-panel"><Icon name="clock" size={28} /><p>No hay reservas para esta fecha.</p></div> : reservations.map((reservation) => (
            <div key={reservation.id} className={`reservation-row status-${reservation.status}`}>
              <div className="reservation-time"><strong>{reservation.time}</strong><span>{reservation.partySize} personas</span></div>
              <div className="reservation-main"><strong>{reservation.name}</strong><span>{reservation.phone || 'Sin teléfono'}{reservation.tableName ? ` · ${reservation.tableName}` : ''}{reservation.notes ? ` · ${reservation.notes}` : ''}</span></div>
              <span className="reservation-status">{STATUS_LABELS[reservation.status]}</span>
              <div className="reservation-actions">
                {reservation.status === 'pending' ? <button type="button" className="btn btn-small btn-secondary" onClick={() => void changeStatus(reservation, 'confirmed')}>Confirmar</button> : null}
                {['pending', 'confirmed'].includes(reservation.status) ? <button type="button" className="btn btn-small btn-primary" onClick={() => void changeStatus(reservation, 'seated')}>Sentar</button> : null}
                {['pending', 'confirmed'].includes(reservation.status) ? <button type="button" className="text-button text-danger" onClick={() => void changeStatus(reservation, 'cancelled')}>Cancelar</button> : null}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <div className="reservation-wait-layout">
          <section className="panel reservation-panel">
            {waitlist.length === 0 ? <div className="empty-panel"><Icon name="users" size={28} /><p>No hay personas esperando.</p></div> : waitlist.map((entry) => <div key={entry.id} className="reservation-row"><div className="reservation-time"><strong>{entry.quotedMinutes} min</strong><span>{entry.partySize} personas</span></div><div className="reservation-main"><strong>{entry.name}</strong><span>{entry.phone || 'Sin teléfono'}{entry.notes ? ` · ${entry.notes}` : ''}</span></div><div className="reservation-actions"><button type="button" className="btn btn-small btn-primary" onClick={() => void changeWait(entry, 'seated')}>Sentar</button><button type="button" className="text-button text-danger" onClick={() => void changeWait(entry, 'cancelled')}>Quitar</button></div></div>)}
          </section>
          <section className="panel reservation-wait-form"><h2>Agregar a la espera</h2><form className="form-grid" onSubmit={addWait}><label className="field field-full"><span className="field-label">Nombre</span><input className="input" value={waitForm.name} onChange={(e) => setWaitForm({ ...waitForm, name: e.target.value })} /></label><label className="field"><span className="field-label">Teléfono</span><input className="input" value={waitForm.phone} onChange={(e) => setWaitForm({ ...waitForm, phone: e.target.value })} /></label><label className="field"><span className="field-label">Personas</span><input className="input" type="number" min={1} value={waitForm.partySize} onChange={(e) => setWaitForm({ ...waitForm, partySize: e.target.value })} /></label><label className="field"><span className="field-label">Espera estimada (min)</span><input className="input" type="number" min={0} value={waitForm.quotedMinutes} onChange={(e) => setWaitForm({ ...waitForm, quotedMinutes: e.target.value })} /></label><button type="submit" className="btn btn-primary field-full"><Icon name="plus" size={17} /> Agregar</button></form></section>
        </div>
      )}
      <ReservationModal open={modalOpen} onClose={() => setModalOpen(false)} date={date} onSave={saveReservation} />
    </div>
  );
}

export default function ReservationsPage() { return <FeatureGate feature="reservations"><ReservationsContent /></FeatureGate>; }
