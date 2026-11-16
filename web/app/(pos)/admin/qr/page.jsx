'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { FeatureGate } from '@/components/FeatureProvider';
import { api } from '@/lib/api';
import QRCode from 'qrcode';

function QrContent() {
  const [tables, setTables] = useState([]);
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(null);
  const [images, setImages] = useState({});
  useEffect(() => {
    setOrigin(window.location.origin);
    api.getTables().then(async (response) => {
      const list = response.tables ?? [];
      setTables(list);
      const entries = await Promise.all(list.map(async (table) => [table.id, await QRCode.toDataURL(`${window.location.origin}/mesa/${table.qrToken}`, { margin: 1, width: 180 })]));
      setImages(Object.fromEntries(entries));
    }).catch(() => {});
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
            {images[table.id] ? <img className="qr-image" src={images[table.id]} alt={`QR de ${table.name}`} /> : <span className="qr-image-placeholder">Generando QR…</span>}
            <code className="qr-link">/mesa/{table.qrToken}</code>
            <div className="qr-actions">
              <button type="button" className="btn btn-small btn-primary" onClick={() => void copy(table)}><Icon name="copy" size={15} /> {copied === table.id ? 'Copiado' : 'Copiar enlace'}</button>
              <button type="button" className="btn btn-small btn-secondary" onClick={async () => { if (!window.confirm('El QR anterior dejará de funcionar. ¿Rotar?')) return; await api.rotateTableQr(table.id); window.location.reload(); }}>Rotar</button>
              <a className="btn btn-small btn-secondary" href={`/mesa/${table.qrToken}`} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> Abrir</a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
export default function QrPage() { return <FeatureGate feature="qr_table_order"><QrContent /></FeatureGate>; }
