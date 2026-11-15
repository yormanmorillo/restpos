'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { FeatureGate } from '@/components/FeatureProvider';
import { api } from '@/lib/api';

function QrContent() {
  const [tables, setTables] = useState([]);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(null);
  useEffect(() => {
    setOrigin(window.location.origin);
    api.getTables().then((response) => setTables(response.tables ?? [])).catch(() => {});
  }, []);
  async function copy(table) {
    const url = `${origin}/mesa/${table.qrToken}`;
    try { await navigator.clipboard.writeText(url); setCopied(table.id); setTimeout(() => setCopied(null), 1600); }
    catch { setCopied(null); }
  }
  return (
    <div className="admin-section-page">
      <div className="page-heading"><div><span className="eyebrow">Salón</span><h1>QR por mesa</h1><p>Cada mesa tiene un enlace único para pedir desde el teléfono.</p></div></div>
      <div className="qr-grid">
        {tables.map((table) => (
          <div key={table.id} className="panel qr-card">
            <span className="qr-table-name">{table.name}</span>
            <span className="field-hint">{table.areaName || 'Sin área'} · {table.capacity} personas</span>
            <code className="qr-link">/mesa/{table.qrToken}</code>
            <div className="qr-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => void copy(table)}><Icon name="copy" size={15} /> {copied === table.id ? 'Copiado' : 'Copiar enlace'}</button>
              <a className="btn btn-small btn-secondary" href={`/mesa/${table.qrToken}`} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> Abrir</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export default function QrPage() { return <FeatureGate feature="qr_table_order"><QrContent /></FeatureGate>; }
