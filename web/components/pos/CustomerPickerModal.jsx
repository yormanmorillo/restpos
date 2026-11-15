'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';

export default function CustomerPickerModal({ open, onClose, onSelect }) {
  const [query, setQuery] = useState('');
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);

  async function search(value = query) {
    setLoading(true);
    setError('');
    try {
      const response = await api.getCustomers(value);
      setCustomers(response.customers ?? []);
    } catch (searchError) { setError(searchError.message || 'No se pudieron cargar los clientes.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    if (!open) return;
    setQuery(''); setName(''); setPhone(''); setError('');
    void search('');
  }, [open]);

  async function create() {
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    setCreating(true); setError('');
    try {
      const response = await api.createCustomer({ name: name.trim(), phone: phone.trim() });
      onSelect(response.customer);
      onClose();
    } catch (createError) { setError(createError.message || 'No se pudo crear el cliente.'); }
    finally { setCreating(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Cliente" subtitle="Busca por nombre o teléfono." size="md" closeDisabled={creating}
      footer={<div className="modal-actions"><span /><button type="button" className="btn btn-secondary" onClick={onClose} disabled={creating}>Cerrar</button></div>}>
      <div className="inline-action">
        <label className="search-field"><Icon name="search" size={19} /><input type="search" placeholder="Nombre o teléfono…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(event.currentTarget.value); }} /></label>
        <button type="button" className="btn btn-secondary" onClick={() => void search()}>Buscar</button>
      </div>
      {loading ? <div className="app-loading"><span className="spinner" /> Buscando…</div> : (
        <div className="customer-picker-list">
          {customers.length === 0 ? <p className="field-hint">Sin clientes. Créalo abajo.</p> : customers.map((customer) => (
            <button key={customer.id} type="button" className="customer-picker-row" onClick={() => { onSelect(customer); onClose(); }}>
              <span className="avatar avatar-small">{customer.name.slice(0, 2).toUpperCase()}</span>
              <span><strong>{customer.name}</strong><small>{customer.phone || 'Sin teléfono'} · {customer.pointsBalance} pts · {formatMoney(customer.totalSpentCents)}</small></span>
              <Icon name="chevronRight" size={17} />
            </button>
          ))}
        </div>
      )}
      <div className="customer-quick-create">
        <h3>Cliente nuevo</h3>
        <div className="form-grid">
          <label className="field"><span className="field-label">Nombre</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /></label>
          <label className="field"><span className="field-label">Teléfono</span><input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={30} /></label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="button" className="btn btn-secondary" onClick={() => void create()} disabled={creating}><Icon name="plus" size={16} /> Crear y asignar</button>
      </div>
    </Modal>
  );
}
