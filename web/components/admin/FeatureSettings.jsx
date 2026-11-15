'use client';

import { useState } from 'react';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { useFeatures } from '@/components/FeatureProvider';

const PHASES = [
  { id: 0, label: 'Módulos actuales' },
  { id: 1, label: 'Fase 1 · Operación diaria' },
  { id: 2, label: 'Fase 2 · Cocina y venta' },
  { id: 3, label: 'Fase 3 · Gestión' },
];

export default function FeatureSettings() {
  const { flags, definitions, reload } = useFeatures();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  async function toggle(key, nextValue) {
    setBusy(key);
    setError('');
    setToast('');
    try {
      await api.updateSettings({ [`feature_${key}`]: String(nextValue) });
      await reload();
      setToast('Función actualizada.');
      window.setTimeout(() => setToast(''), 2500);
    } catch (saveError) {
      setError(saveError.message || 'No se pudo actualizar la función.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel settings-panel feature-settings">
      <div className="panel-heading">
        <div><h2>Funciones activables</h2><p>Activa solo lo que quieras mostrar en el restaurante. Si está apagado, no aparece.</p></div>
        <Icon name="sliders" size={22} />
      </div>
      {error ? <div className="alert alert-error"><Icon name="alert" size={18} /><p>{error}</p></div> : null}
      {PHASES.map((phase) => {
        const entries = Object.entries(definitions).filter(([, definition]) => definition.phase === phase.id);
        if (entries.length === 0) return null;
        return (
          <div key={phase.id} className="feature-phase">
            <h3 className="feature-phase-title">{phase.label}</h3>
            <div className="feature-flag-list">
              {entries.map(([key, definition]) => (
                <label key={key} className="feature-flag-row">
                  <span><strong>{definition.label}</strong><small>{definition.description}</small></span>
                  <span className="feature-flag-control">
                    <input
                      type="checkbox"
                      checked={Boolean(flags[key])}
                      onChange={(event) => void toggle(key, event.target.checked)}
                      disabled={busy !== null}
                      aria-label={`Activar ${definition.label}`}
                    />
                    <span className="toggle-track" aria-hidden="true"><span /></span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
      {toast ? <p className="feature-toast" role="status">{toast}</p> : null}
    </section>
  );
}
