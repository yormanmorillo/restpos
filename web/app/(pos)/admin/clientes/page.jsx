'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { FeatureGate } from '@/components/FeatureProvider';
import { api } from '@/lib/api';
import { formatMoney, formatTime } from '@/lib/format';

function CustomersContent() {
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '', notes: '' });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async (value = '') => {
    setLoading(true);
    try { const response = await api.getCustomers(value); setCustomers(response.customers ?? []); setError(''); }
    catch (e) { setError(e.message || 'No se pudieron cargar los clientes.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(event) {
    event.preventDefault();
    if (!form.name.trim()) { setError('El nombre es obligatorio.'); return; }
    setCreating(true); setError('');
    try {
      const response = await api.createCustomer(form);
      setCustomers((previous) => [response.customer, ...previous]);
      setForm({ name: '', phone: '', email: '', notes: '' });
    } catch (e) { setError(e.message || 'No se pudo crear el cliente.'); }
    finally { setCreating(false); }
  }

  async function openDetail(customer) {
    setSelected(customer);
    setDetail(null);
    try { const response = await api.getCustomer(customer.id); setDetail(response.customer); }
    catch (e) { setError(e.message || 'No se pudo cargar el historial.'); }
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading"><div><span className="eyebrow">Clientes</span><h1>Clientes y fidelidad</h1><p>Historial, puntos y datos de contacto.</p></div></div>
      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p></div> : null}
      <div className="customer-admin-layout">
        <section className="panel">
          <div className="admin-toolbar"><div><h2>Directorio</h2><p>{customers.length} clientes</p></div><label className="search-field search-field-small"><Icon name="search" size={17} /><input type="search" placeholder="Buscar…" value={query} onChange={(event) => { setQuery(event.target.value); void load(event.target.value); }} /></label></div>
          {loading ? <div className="app-loading"><span className="spinner" /> Cargando…</div> : customers.length === 0 ? <div className="empty-panel"><Icon name="users" size={28} /><p>Sin clientes registrados.</p></div> : (
            <div className="customer-admin-list">
              {customers.map((customer) => (
                <button key={customer.id} type="button" className="customer-admin-row" onClick={() => void openDetail(customer)}>
                  <span className="avatar avatar-small">{customer.name.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{customer.name}</strong><small>{customer.phone || 'Sin teléfono'} · {customer.pointsBalance} pts</small></span>
                  <strong>{formatMoney(customer.totalSpentCents)}</strong>
                  <Icon name="chevronRight" size={16} />
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="panel customer-create-panel">
          <h2>Nuevo cliente</h2>
          <form className="form-grid" onSubmit={create}>
            <label className="field field-full"><span className="field-label">Nombre</span><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={100} /></label>
            <label className="field"><span className="field-label">Teléfono</span><input className="input" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} maxLength={30} /></label>
            <label className="field"><span className="field-label">Correo</span><input className="input" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} maxLength={120} /></label>
            <label className="field field-full"><span className="field-label">Notas</span><input className="input" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={500} /></label>
            <button type="submit" className="btn btn-primary field-full" disabled={creating}><Icon name="plus" size={17} /> Crear cliente</button>
          </form>
        </section>
      </div>
      <Modal open={Boolean(selected)} onClose={() => { setSelected(null); setDetail(null); }} title={selected?.name ?? 'Cliente'} subtitle={selected?.phone || 'Sin teléfono'} size="md" footer={<div className="modal-actions"><span /><button type="button" className="btn btn-secondary" onClick={() => { setSelected(null); setDetail(null); }}>Cerrar</button></div>}>
        {!detail ? <div className="app-loading"><span className="spinner" /> Cargando historial…</div> : (
          <div className="customer-detail">
            <div className="customer-detail-stats"><div><span>Puntos</span><strong>{detail.pointsBalance}</strong></div><div><span>Visitas</span><strong>{detail.visits}</strong></div><div><span>Consumo</span><strong>{formatMoney(detail.totalSpentCents)}</strong></div></div>
            <h3>Historial</h3>
            {detail.orders.length === 0 ? <p className="field-hint">Sin pedidos.</p> : <div className="customer-order-list">{detail.orders.map((order) => <div key={order.id} className="customer-order-row"><span><strong>{order.orderNumber}</strong><small>{formatTime(order.paidAt || order.createdAt)} · {order.status}</small></span><strong>{formatMoney(order.totalCents)}</strong></div>)}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default function CustomersPage() { return <FeatureGate feature="customers_loyalty"><CustomersContent /></FeatureGate>; }
