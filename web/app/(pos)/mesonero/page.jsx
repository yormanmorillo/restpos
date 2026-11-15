'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Icon from '@/components/Icon';
import { FeatureGate } from '@/components/FeatureProvider';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';

function WaiterContent() {
  const [tables, setTables] = useState([]);
  const [error, setError] = useState('');
  const openTables = useMemo(() => tables.filter((table) => table.openOrder), [tables]);
  const freeTables = useMemo(() => tables.filter((table) => !table.openOrder && table.active), [tables]);
  useEffect(() => { api.getTables().then((response) => setTables(response.tables ?? [])).catch((e) => setError(e.message || 'No se pudieron cargar las mesas.')); }, []);
  return (
    <div className="waiter-page">
      <div className="page-heading"><div><span className="eyebrow">Salón</span><h1>Mesero</h1><p>Mesas abiertas y disponibles.</p></div><Link href="/" className="btn btn-primary"><Icon name="pos" size={18} /> Abrir POS</Link></div>
      {error ? <div className="alert alert-error"><Icon name="alert" size={18} /><p>{error}</p></div> : null}
      <section className="panel waiter-panel"><h2>Mesas abiertas <span className="tab-count">{openTables.length}</span></h2>{openTables.length === 0 ? <p className="field-hint">No hay mesas abiertas.</p> : <div className="waiter-grid">{openTables.map((table) => <Link key={table.id} href={`/?order=${table.openOrder.id}`} className="waiter-table is-open"><span className="waiter-table-top"><strong>{table.name}</strong><Icon name="chevronRight" size={17} /></span><span>{table.areaName || 'Sin área'}</span><strong>{table.openOrder.orderNumber}</strong></Link>)}</div>}</section>
      <section className="panel waiter-panel"><h2>Mesas disponibles <span className="tab-count">{freeTables.length}</span></h2><div className="waiter-grid">{freeTables.map((table) => <Link key={table.id} href="/" className="waiter-table"><span className="waiter-table-top"><strong>{table.name}</strong></span><span>{table.areaName || 'Sin área'} · {table.capacity} personas</span></Link>)}</div></section>
    </div>
  );
}
export default function WaiterPage() { return <FeatureGate feature="qr_table_order"><WaiterContent /></FeatureGate>; }
