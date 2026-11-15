'use client';

import { useState } from 'react';
import Icon from './Icon';
import { api } from '@/lib/api';
import { useFeatures } from '@/components/FeatureProvider';

export default function ShareWhatsAppButton({ orderId, compact = false, className = 'btn btn-secondary' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { enabled } = useFeatures();

  if (!enabled('whatsapp_receipt')) return null;

  async function share() {
    setBusy(true);
    setError('');
    try {
      const data = await api.getOrderShare(orderId);
      const absoluteUrl = `${window.location.origin}${data.url}`;
      const text = `${data.message}\n\nVer factura: ${absoluteUrl}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    } catch (shareError) {
      setError(shareError.message || 'No se pudo preparar la factura.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={`share-whatsapp ${compact ? 'is-compact' : ''}`}>
      <button type="button" className={className} onClick={() => void share()} disabled={busy} title="Enviar factura por WhatsApp">
        {busy ? <span className="spinner spinner-small" /> : <Icon name="whatsapp" size={compact ? 17 : 19} />}
        {compact ? null : 'WhatsApp'}
      </button>
      {error ? <span className="share-whatsapp-error">{error}</span> : null}
    </span>
  );
}
