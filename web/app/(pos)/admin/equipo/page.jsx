'use client';

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import StaffModal from '@/components/admin/StaffModal';
import { useAuth, ROLE_LABELS } from '@/components/auth/AuthProvider';
import { api } from '@/lib/api';

function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

export default function StaffPage() {
  const { staff: currentStaff } = useAuth();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState({ open: false, person: null });
  const [toast, setToast] = useState(null);
  const isAdmin = currentStaff?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.getStaff();
      setStaff(response.staff ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudo cargar el equipo.');
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

  async function savePerson(payload) {
    if (modal.person) {
      const response = await api.updateStaff(modal.person.id, payload);
      setStaff((previous) => previous.map((person) => person.id === response.staff.id ? response.staff : person));
      setToast({ type: 'success', message: `${response.staff.name} actualizado.` });
    } else {
      const response = await api.createStaff(payload);
      setStaff((previous) => [...previous, response.staff]);
      setToast({ type: 'success', message: `${response.staff.name} agregado al equipo.` });
    }
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Equipo</span>
          <h1>Empleados y accesos</h1>
          <p>Cada persona tiene su propio PIN y permisos según su rol.</p>
        </div>
        {isAdmin ? (
          <button type="button" className="btn btn-primary" onClick={() => setModal({ open: true, person: null })}>
            <Icon name="plus" size={19} /> Nuevo empleado
          </button>
        ) : null}
      </div>

      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p><button className="btn btn-small btn-secondary" onClick={() => void load()}>Reintentar</button></div> : null}

      {loading ? (
        <div className="admin-skeleton">{[1,2,3].map((index) => <div key={index} className="admin-row skeleton-card"><div className="skeleton-line title" /></div>)}</div>
      ) : (
        <div className="staff-grid">
          {staff.map((person) => (
            <article key={person.id} className={`staff-card ${person.active ? '' : 'is-inactive'}`}>
              <div className="staff-card-top">
                <span className="avatar avatar-medium">{initials(person.name)}</span>
                <span className={`role-badge role-${person.role}`}>{ROLE_LABELS[person.role] ?? person.role}</span>
              </div>
              <h3>{person.name}</h3>
              <p>{person.active ? 'Acceso activo' : 'Acceso desactivado'}</p>
              <div className="staff-card-actions">
                {isAdmin ? (
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => setModal({ open: true, person })} disabled={!person.active && person.id === currentStaff?.id}>
                    <Icon name="edit" size={16} /> Editar
                  </button>
                ) : <span className="field-hint">Solo un administrador puede editar.</span>}
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="admin-footnote-panel">
        <Icon name="lock" size={16} />
        <p>Los PIN son privados y no se pueden consultar. Un administrador puede asignar uno nuevo en cualquier momento.</p>
      </div>

      <StaffModal
        open={modal.open}
        person={modal.person}
        onClose={() => setModal({ open: false, person: null })}
        onSubmit={savePerson}
      />
      {toast ? <div className={`toast toast-${toast.type}`}>{toast.message}</div> : null}
    </div>
  );
}
