'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { FeatureGate } from '@/components/FeatureProvider';
import { api } from '@/lib/api';

function StationModal({ open, station, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#c45d3a');
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(station?.name ?? ''); setColor(station?.color ?? '#c45d3a');
    setSortOrder(String(station?.sortOrder ?? 0)); setActive(station?.active ?? true); setError(''); setBusy(false);
  }, [open, station]);
  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    setBusy(true); setError('');
    try { await onSubmit({ name: name.trim(), color, sortOrder: Number(sortOrder) || 0, active }); onClose(); }
    catch (e) { setError(e.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={station ? 'Editar estación' : 'Nueva estación'} subtitle="Barra, parrilla, postres u otra área de preparación." size="sm" closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="station-form" className="btn btn-primary" disabled={busy}>Guardar</button></div></div>}>
      <form id="station-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full"><span className="field-label">Nombre</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} autoFocus /></label>
        <label className="field"><span className="field-label">Color</span><input className="input" type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        <label className="field"><span className="field-label">Orden</span><input className="input" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></label>
        <label className="toggle-row field field-full"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span><span><strong>Estación activa</strong></span></label>
        {error ? <p className="form-error field-full">{error}</p> : null}
      </form>
    </Modal>
  );
}

function StationPageContent() {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState({ open: false, station: null });

  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await api.getAdminKitchenStations(); setStations(response.stations ?? []); setError(''); }
    catch (e) { setError(e.message || 'No se pudieron cargar las estaciones.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(payload) {
    if (modal.station) {
      const response = await api.updateKitchenStation(modal.station.id, payload);
      setStations((previous) => previous.map((station) => station.id === response.station.id ? response.station : station));
    } else {
      const response = await api.createKitchenStation(payload);
      setStations((previous) => [...previous, response.station]);
    }
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading"><div><span className="eyebrow">Cocina</span><h1>Estaciones</h1><p>Asigna cada producto a barra, parrilla, postres u otra estación.</p></div><button type="button" className="btn btn-primary" onClick={() => setModal({ open: true, station: null })}><Icon name="plus" size={19} /> Nueva estación</button></div>
      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p></div> : null}
      {loading ? <div className="app-loading"><span className="spinner" /> Cargando estaciones…</div> : (
        <div className="panel station-admin-list">
          {stations.map((station) => (
            <div key={station.id} className={`station-admin-row ${station.active ? '' : 'is-inactive'}`}>
              <span className="station-admin-color" style={{ background: station.color }} />
              <div><strong>{station.name}</strong><span>Orden {station.sortOrder} · {station.active ? 'Activa' : 'Inactiva'}</span></div>
              <button type="button" className="btn btn-small btn-secondary" onClick={() => setModal({ open: true, station })}><Icon name="edit" size={16} /> Editar</button>
            </div>
          ))}
        </div>
      )}
      <StationModal open={modal.open} station={modal.station} onClose={() => setModal({ open: false, station: null })} onSubmit={save} />
    </div>
  );
}

export default function KitchenStationsPage() {
  return <FeatureGate feature="kitchen_stations"><StationPageContent /></FeatureGate>;
}
