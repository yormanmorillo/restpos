'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import ModifierGroupModal from '@/components/admin/ModifierGroupModal';
import ProductModifierGroupsModal from '@/components/admin/ProductModifierGroupsModal';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';

export default function ModifiersPage() {
  const [groups, setGroups] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [groupModal, setGroupModal] = useState({ open: false, group: null });
  const [assignModal, setAssignModal] = useState({ open: false, product: null });
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [groupsResponse, productsResponse] = await Promise.all([
        api.getModifierGroups(),
        api.getAdminProducts(),
      ]);
      setGroups(groupsResponse.groups ?? []);
      setProducts(productsResponse.products ?? []);
      setError('');
    } catch (loadError) {
      setError(loadError.message || 'No se pudieron cargar los modificadores.');
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

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');
    if (!query) return products;
    return products.filter((product) => product.name.toLocaleLowerCase('es').includes(query));
  }, [products, search]);

  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);

  async function saveGroup(payload) {
    if (groupModal.group) {
      const response = await api.updateModifierGroup(groupModal.group.id, payload);
      setGroups((previous) => previous.map((group) => group.id === response.group.id ? response.group : group));
      setToast({ type: 'success', message: `Grupo “${response.group.name}” actualizado.` });
    } else {
      const response = await api.createModifierGroup(payload);
      setGroups((previous) => [...previous, response.group]);
      setToast({ type: 'success', message: `Grupo “${response.group.name}” creado.` });
    }
    await load();
  }

  async function assign(product, groupIds) {
    const response = await api.setProductModifierGroups(product.id, groupIds);
    setProducts((previous) => previous.map((entry) => entry.id === product.id ? { ...entry, modifierGroupIds: response.groups.map((group) => group.id) } : entry));
    setToast({ type: 'success', message: `Opciones de “${product.name}” actualizadas.` });
  }

  return (
    <div className="admin-section-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Menú avanzado</span>
          <h1>Modificadores y extras</h1>
          <p>Crea grupos de opciones y asígnalos a los productos que lo necesiten.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setGroupModal({ open: true, group: null })}>
          <Icon name="plus" size={19} /> Nuevo grupo
        </button>
      </div>

      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p><button type="button" className="btn btn-small btn-secondary" onClick={() => void load()}>Reintentar</button></div> : null}

      {loading ? <div className="app-loading"><span className="spinner" /> Cargando modificadores…</div> : (
        <>
          <div className="modifier-admin-grid">
            {groups.map((group) => (
              <article key={group.id} className={`modifier-admin-card ${group.active ? '' : 'is-inactive'}`}>
                <div className="modifier-admin-head">
                  <span className="modifier-admin-icon"><Icon name="sliders" size={20} /></span>
                  <span className={`status-badge ${group.active ? 'is-active' : 'is-inactive'}`}>{group.active ? 'Activo' : 'Inactivo'}</span>
                </div>
                <h3>{group.name}</h3>
                <p>{group.selectionType === 'single' ? 'Selección única' : 'Selección múltiple'} · {group.required ? 'obligatorio' : 'opcional'}</p>
                <div className="modifier-admin-options">
                  {group.options.map((option) => (
                    <div key={option.id}><span>{option.name}</span><strong>{option.priceDeltaCents > 0 ? `+${formatMoney(option.priceDeltaCents)}` : 'Incluido'}</strong></div>
                  ))}
                </div>
                <button type="button" className="btn btn-small btn-secondary" onClick={() => setGroupModal({ open: true, group })}>
                  <Icon name="edit" size={16} /> Editar grupo
                </button>
              </article>
            ))}
          </div>

          <section className="panel product-options-panel">
            <div className="panel-heading">
              <div><h2>Opciones por producto</h2><p>Selecciona qué grupos aparecen al vender cada producto.</p></div>
              <label className="search-field search-field-small"><Icon name="search" size={18} /><input type="search" placeholder="Buscar producto…" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
            </div>
            <div className="product-options-list">
              {filteredProducts.map((product) => (
                <div key={product.id} className="product-options-row">
                  <div><strong>{product.name}</strong><span>{product.categoryName}</span></div>
                  <div className="product-options-tags">
                    {(product.modifierGroupIds ?? []).length === 0 ? <span className="field-hint">Sin opciones</span> : (product.modifierGroupIds ?? []).map((id) => <span key={id} className="category-tag">{groupsById.get(id)?.name ?? 'Grupo'}</span>)}
                  </div>
                  <button type="button" className="btn btn-small btn-secondary" onClick={() => setAssignModal({ open: true, product })}>Configurar</button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <ModifierGroupModal open={groupModal.open} group={groupModal.group} onClose={() => setGroupModal({ open: false, group: null })} onSubmit={saveGroup} />
      <ProductModifierGroupsModal
        open={assignModal.open}
        product={assignModal.product}
        groups={groups}
        onClose={() => setAssignModal({ open: false, product: null })}
        onSubmit={(groupIds) => assign(assignModal.product, groupIds)}
      />
      {toast ? <div className={`toast toast-${toast.type}`}>{toast.message}</div> : null}
    </div>
  );
}
