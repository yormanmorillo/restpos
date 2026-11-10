'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import AreaModal from '@/components/admin/AreaModal';
import TableModal from '@/components/admin/TableModal';
import { api } from '@/lib/api';

export default function FloorAdminPage() {
  const [areas, setAreas] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [areaModal, setAreaModal] = useState({ open: false, area: null });
  const [tableModal, setTableModal] = useState({ open: false, table: null });
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [areasResponse, tablesResponse] = await Promise.all([api.getAreas(), api.getAdminTables()]);
      setAreas(areasResponse.areas ?? []);
      setTables(tablesResponse.tables ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el salón.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function saveArea(payload) {
    if (areaModal.area) {
      const response = await api.updateArea(areaModal.area.id, payload);
      setAreas((previous) => previous.map((area) => area.id === response.area.id ? response.area : area));
      setToast({ type: 'success', message: `Área “${response.area.name}” actualizada.` });
    } else {
      const response = await api.createArea(payload);
      setAreas((previous) => [...previous, response.area]);
      setToast({ type: 'success', message: `Área “${response.area.name}” creada.` });
    }
    await load();
  }

  async function saveTable(payload) {
    if (tableModal.table) {
      const response = await api.updateTable(tableModal.table.id, payload);
      setTables((previous) => previous.map((table) => table.id === response.table.id ? response.table : table));
      setToast({ type: 'success', message: `Mesa “${response.table.name}” actualizada.` });
    } else {
      const response = await api.createTable(payload);
      setTables((previous) => [...previous, response.table]);
      setToast({ type: 'success', message: `Mesa “${response.table.name}” creada.` });
    }
    await load();
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Salón</span>
          <h1>Áreas y mesas</h1>
          <p>Organiza el piso por zonas y administra la capacidad de cada mesa.</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setAreaModal({ open: true, area: null })}><Icon name="plus" size={19} /> Nueva área</button>
          <button type="button" className="btn btn-primary" onClick={() => setTableModal({ open: true, table: null })} disabled={areas.length === 0}><Icon name="plus" size={19} /> Nueva mesa</button>
        </div>
      </div>

      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p><button type="button" className="btn btn-small btn-secondary" onClick={() => void load()}>Reintentar</button></div> : null}

      {loading ? <div className="app-loading"><span className="spinner" /> Cargando salón…</div> : (
        <>
          <div className="area-admin-grid">
            {areas.map((area) => (
              <article key={area.id} className={`area-admin-card ${area.active ? '' : 'is-inactive'}`}>
                <div className="area-admin-top"><span className="area-admin-icon"><Icon name="table" size={20} /></span><span className={`status-badge ${area.active ? 'is-active' : 'is-inactive'}`}>{area.active ? 'Activa' : 'Inactiva'}</span></div>
                <h3>{area.name}</h3>
                <p>{area.tableCount} mesas</p>
                <button type="button" className="btn btn-small btn-secondary" onClick={() => setAreaModal({ open: true, area })}><Icon name="edit" size={16} /> Editar área</button>
              </article>
            ))}
          </div>

          <section className="panel">
            <div className="panel-heading"><div><h2>Mesas</h2><p>{tables.filter((table) => table.active).length} mesas activas</p></div></div>
            <div className="admin-table-grid">
              {tables.map((table) => (
                <article key={table.id} className={`floor-admin-card ${table.active ? '' : 'is-inactive'}`}>
                  <div className="floor-card-top">
                    <span className="floor-table-name">{table.name}</span>
                    <span className={`status-badge ${table.openOrder ? 'is-active' : 'is-inactive'}`}>{table.openOrder ? 'Ocupada' : table.active ? 'Libre' : 'Inactiva'}</span>
                  </div>
                  <div className="floor-card-meta">
                    <span><Icon name="users" size={15} /> {table.capacity} personas</span>
                    <span><Icon name="pin" size={15} /> {table.areaName ?? 'Sin área'}</span>
                  </div>
                  {table.openOrder ? <p className="field-hint">Pedido abierto {table.openOrder.orderNumber}</p> : null}
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => setTableModal({ open: true, table })}><Icon name="edit" size={16} /> Editar</button>
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      <AreaModal open={areaModal.open} area={areaModal.area} onClose={() => setAreaModal({ open: false, area: null })} onSubmit={saveArea} />
      <TableModal open={tableModal.open} table={tableModal.table} areas={areas} onClose={() => setTableModal({ open: false, table: null })} onSubmit={saveTable} />
      {toast ? <div className={`toast toast-${toast.type}`}>{toast.message}</div> : null}
    </div>
  );
}
