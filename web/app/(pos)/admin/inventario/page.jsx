'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import Modal from '@/components/Modal';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { FeatureGate } from '@/components/FeatureProvider';

const UNIT_OPTIONS = [['g', 'gramos'], ['ml', 'mililitros'], ['pz', 'piezas']];
const UNIT_LABELS = { g: 'g', ml: 'ml', pz: 'pz' };
const MOVEMENT_LABELS = { receipt: 'Entrada', adjustment: 'Ajuste', consumption: 'Consumo por venta', waste: 'Merma' };

function quantity(value) {
  return Number(value).toLocaleString('es-MX', { maximumFractionDigits: 3, minimumFractionDigits: 0 });
}

function ItemModal({ open, item, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState('g');
  const [minQuantity, setMinQuantity] = useState('0');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? ''); setSku(item?.sku ?? ''); setUnit(item?.unit ?? 'g');
    setMinQuantity(String(item?.minQuantity ?? 0)); setActive(item?.active ?? true); setError(''); setBusy(false);
  }, [open, item]);
  async function submit(event) {
    event.preventDefault();
    if (!name.trim()) { setError('El nombre es obligatorio.'); return; }
    setBusy(true); setError('');
    try { await onSubmit({ name: name.trim(), sku: sku.trim(), unit, minQuantity: Number(minQuantity) || 0, active }); onClose(); }
    catch (e) { setError(e.message || 'No se pudo guardar.'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={item ? 'Editar insumo' : 'Nuevo insumo'} subtitle="Materia prima o producto de inventario." size="sm" closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="inventory-item-form" className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner spinner-small" /> : null}Guardar</button></div></div>}>
      <form id="inventory-item-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full"><span className="field-label">Nombre</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus placeholder="Ej. Pasta, queso, tomate" /></label>
        <label className="field"><span className="field-label">SKU <small className="field-hint">opcional</small></span><input className="input" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={60} /></label>
        <label className="field"><span className="field-label">Unidad</span><select className="input select" value={unit} onChange={(e) => setUnit(e.target.value)}>{UNIT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span className="field-label">Stock mínimo</span><input className="input" type="number" min={0} step="0.001" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} /></label>
        <label className="toggle-row field field-full"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span className="toggle-track" aria-hidden="true"><span /></span><span><strong>Insumo activo</strong></span></label>
        {error ? <p className="form-error field-full">{error}</p> : null}
      </form>
    </Modal>
  );
}

function ReceiveModal({ open, item, items, onClose, onSubmit }) {
  const [itemId, setItemId] = useState('');
  const [amount, setAmount] = useState('');
  const [cost, setCost] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setItemId(String(item?.id ?? items[0]?.id ?? '')); setAmount(''); setCost(''); setReference(''); setNotes(''); setError(''); setBusy(false);
  }, [open, item, items]);
  const selected = items.find((entry) => entry.id === Number(itemId));
  async function submit(event) {
    event.preventDefault();
    if (!selected) { setError('Selecciona un insumo.'); return; }
    if (!amount || Number(amount) <= 0) { setError('Ingresa una cantidad mayor que cero.'); return; }
    setBusy(true); setError('');
    try {
      await onSubmit(selected.id, { quantity: Number(amount), costCents: Math.round(Number(cost || 0) * 100), reference: reference.trim(), notes: notes.trim() });
      onClose();
    } catch (e) { setError(e.message || 'No se pudo recibir la mercancía.'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Recibir mercancía" subtitle="Registra lo que entra a la tienda." size="sm" closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="receive-form" className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner spinner-small" /> : <Icon name="box" size={18} />} Recibir</button></div></div>}>
      <form id="receive-form" className="form-grid" onSubmit={submit}>
        <label className="field field-full"><span className="field-label">Insumo</span><select className="input select" value={itemId} onChange={(e) => setItemId(e.target.value)}>{items.filter((entry) => entry.active).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({UNIT_LABELS[entry.unit]})</option>)}</select></label>
        <label className="field"><span className="field-label">Cantidad que entra</span><input className="input" type="number" min="0.001" step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus /></label>
        <label className="field"><span className="field-label">Costo total <small className="field-hint">opcional</small></span><div className="money-input-wrap"><span className="money-prefix">₡</span><input className="input money-input" type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" /></div></label>
        <label className="field field-full"><span className="field-label">Referencia <small className="field-hint">factura, proveedor…</small></span><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></label>
        <label className="field field-full"><span className="field-label">Notas</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></label>
        {selected ? <p className="field-hint field-full">Entrarán {quantity(Number(amount) || 0)} {UNIT_LABELS[selected.unit]} de {selected.name}.</p> : null}
        {error ? <p className="form-error field-full">{error}</p> : null}
      </form>
    </Modal>
  );
}

function AdjustModal({ open, item, onClose, onSubmit }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setCounted(String(item?.currentQuantity ?? 0)); setNotes(''); setError(''); setBusy(false);
  }, [open, item]);
  async function submit(event) {
    event.preventDefault();
    if (counted === '' || Number(counted) < 0) { setError('Ingresa un conteo válido.'); return; }
    setBusy(true); setError('');
    try { await onSubmit(item.id, { countedQuantity: Number(counted), notes: notes.trim() }); onClose(); }
    catch (e) { setError(e.message || 'No se pudo ajustar.'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Ajustar inventario" subtitle="Corrige el stock con un conteo físico." size="sm" closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="adjust-form" className="btn btn-primary" disabled={busy}>Guardar ajuste</button></div></div>}>
      <form id="adjust-form" className="form-grid" onSubmit={submit}>
        <div className="inventory-adjust-summary"><span>Stock actual</span><strong>{quantity(item?.currentQuantity ?? 0)} {UNIT_LABELS[item?.unit]}</strong></div>
        <label className="field field-full"><span className="field-label">Conteo físico</span><input className="input" type="number" min="0" step="0.001" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus /></label>
        <label className="field field-full"><span className="field-label">Notas</span><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Motivo del ajuste" /></label>
        {error ? <p className="form-error field-full">{error}</p> : null}
      </form>
    </Modal>
  );
}

function MovementsModal({ open, item, onClose }) {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.getInventoryMovements({ itemId: item?.id, limit: 100 }).then((response) => setMovements(response.movements ?? [])).finally(() => setLoading(false));
  }, [open, item]);
  return (
    <Modal open={open} onClose={onClose} title="Movimientos de inventario" subtitle={item?.name} size="md" footer={<div className="modal-actions"><span /><button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button></div>}>
      {loading ? <div className="app-loading"><span className="spinner" /> Cargando…</div> : movements.length === 0 ? <p className="field-hint">Sin movimientos registrados.</p> : (
        <div className="inventory-movement-list">
          {movements.map((movement) => (
            <div key={movement.id} className="inventory-movement-row">
              <span className={`movement-chip movement-${movement.type}`}>{MOVEMENT_LABELS[movement.type] ?? movement.type}</span>
              <div><strong className={movement.quantity >= 0 ? 'text-success' : 'text-danger'}>{movement.quantity > 0 ? '+' : ''}{quantity(movement.quantity)} {UNIT_LABELS[item?.unit]}</strong><span>{movement.reference || movement.notes || 'Sin referencia'}</span></div>
              <time>{new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(movement.createdAt))}</time>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function RecipeModal({ open, recipe, items, onClose, onSubmit }) {
  const [rows, setRows] = useState([{ inventoryItemId: '', quantity: '' }]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setRows(recipe?.ingredients?.length ? recipe.ingredients.map((ingredient) => ({ inventoryItemId: String(ingredient.inventoryItemId), quantity: String(ingredient.quantity) })) : [{ inventoryItemId: '', quantity: '' }]);
    setError(''); setBusy(false);
  }, [open, recipe]);
  function update(index, key, value) { setRows((previous) => previous.map((row, i) => i === index ? { ...row, [key]: value } : row)); }
  async function submit(event) {
    event.preventDefault();
    const ingredients = rows.filter((row) => row.inventoryItemId && Number(row.quantity) > 0).map((row) => ({ inventoryItemId: Number(row.inventoryItemId), quantity: Number(row.quantity) }));
    setBusy(true); setError('');
    try { await onSubmit(recipe.productId, ingredients); onClose(); }
    catch (e) { setError(e.message || 'No se pudo guardar la receta.'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Receta del producto" subtitle={recipe?.productName} size="md" closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button type="submit" form="recipe-form" className="btn btn-primary" disabled={busy}>Guardar receta</button></div></div>}>
      <form id="recipe-form" className="form-grid" onSubmit={submit}>
        <p className="field-hint field-full">Cantidad de cada insumo que se descuenta por <strong>una unidad vendida</strong> de este producto.</p>
        <div className="recipe-editor-list field-full">
          {rows.map((row, index) => (
            <div key={index} className="recipe-editor-row">
              <select className="input select" value={row.inventoryItemId} onChange={(e) => update(index, 'inventoryItemId', e.target.value)}>
                <option value="">Selecciona insumo…</option>
                {items.filter((entry) => entry.active).map((entry) => <option key={entry.id} value={entry.id}>{entry.name} ({UNIT_LABELS[entry.unit]})</option>)}
              </select>
              <input className="input" type="number" min="0.001" step="0.001" value={row.quantity} onChange={(e) => update(index, 'quantity', e.target.value)} placeholder="Cantidad" />
              <button type="button" className="icon-button" onClick={() => setRows((previous) => previous.filter((_, i) => i !== index))} disabled={rows.length === 1} aria-label="Quitar ingrediente"><Icon name="trash" size={16} /></button>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-small btn-secondary" onClick={() => setRows((previous) => [...previous, { inventoryItemId: '', quantity: '' }])}><Icon name="plus" size={16} /> Agregar ingrediente</button>
        {error ? <p className="form-error field-full">{error}</p> : null}
      </form>
    </Modal>
  );
}

function InventoryPageContent() {
  const [tab, setTab] = useState('stock');
  const [items, setItems] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [itemModal, setItemModal] = useState({ open: false, item: null });
  const [receiveModal, setReceiveModal] = useState({ open: false, item: null });
  const [adjustModal, setAdjustModal] = useState({ open: false, item: null });
  const [movementsModal, setMovementsModal] = useState({ open: false, item: null });
  const [recipeModal, setRecipeModal] = useState({ open: false, recipe: null });
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [itemsResponse, recipesResponse] = await Promise.all([api.getInventoryItems(), api.getRecipes()]);
      setItems(itemsResponse.items ?? []); setRecipes(recipesResponse.recipes ?? []); setError('');
    } catch (e) { setError(e.message || 'No se pudo cargar el inventario.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return undefined; const timer = setTimeout(() => setToast(null), 4000); return () => clearTimeout(timer); }, [toast]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((item) => item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)) : items;
  }, [items, search]);
  const lowStock = items.filter((item) => item.active && item.lowStock).length;

  async function saveItem(payload) {
    if (itemModal.item) { const response = await api.updateInventoryItem(itemModal.item.id, payload); setItems((previous) => previous.map((item) => item.id === response.item.id ? response.item : item)); setToast({ type: 'success', message: 'Insumo actualizado.' }); }
    else { const response = await api.createInventoryItem(payload); setItems((previous) => [...previous, response.item]); setToast({ type: 'success', message: 'Insumo creado.' }); }
  }
  async function receive(itemId, payload) { const response = await api.receiveInventory(itemId, payload); setItems((previous) => previous.map((item) => item.id === response.item.id ? response.item : item)); setToast({ type: 'success', message: `Entrada registrada: ${response.item.name}.` }); }
  async function adjust(itemId, payload) { const response = await api.adjustInventory(itemId, payload); setItems((previous) => previous.map((item) => item.id === response.item.id ? response.item : item)); setToast({ type: 'success', message: 'Inventario ajustado.' }); }
  async function saveRecipe(productId, ingredients) { const response = await api.saveRecipe(productId, ingredients); setRecipes((previous) => previous.map((recipe) => recipe.productId === productId ? response.recipe : recipe)); setToast({ type: 'success', message: 'Receta actualizada.' }); }

  return (
    <div className="admin-section-page inventory-page">
      <div className="page-heading">
        <div><span className="eyebrow">Operación</span><h1>Inventario y recetas</h1><p>Recibe mercancía, controla existencias y descuenta ingredientes al vender.</p></div>
        <div className="heading-actions"><button type="button" className="btn btn-secondary" onClick={() => setReceiveModal({ open: true, item: null })} disabled={items.length === 0}><Icon name="box" size={19} /> Recibir mercancía</button><button type="button" className="btn btn-primary" onClick={() => setItemModal({ open: true, item: null })}><Icon name="plus" size={19} /> Nuevo insumo</button></div>
      </div>

      {error ? <div className="alert alert-error"><Icon name="alert" size={19} /><p>{error}</p><button type="button" className="btn btn-small btn-secondary" onClick={() => void load()}>Reintentar</button></div> : null}

      <div className="inventory-summary">
        <div><span>Insumos</span><strong>{items.length}</strong></div>
        <div><span>Stock bajo</span><strong className={lowStock ? 'text-danger' : ''}>{lowStock}</strong></div>
        <div><span>Recetas</span><strong>{recipes.filter((recipe) => recipe.ingredients.length > 0).length}</strong></div>
      </div>

      <div className="admin-tabs inventory-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'stock'} className={tab === 'stock' ? 'is-active' : ''} onClick={() => setTab('stock')}><Icon name="box" size={18} /> Stock <span className="tab-count">{items.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'recipes'} className={tab === 'recipes' ? 'is-active' : ''} onClick={() => setTab('recipes')}><Icon name="chef" size={18} /> Recetas <span className="tab-count">{recipes.filter((recipe) => recipe.ingredients.length > 0).length}</span></button>
      </div>

      {loading ? <div className="app-loading"><span className="spinner" /> Cargando inventario…</div> : tab === 'stock' ? (
        <section className="panel inventory-panel">
          <div className="admin-toolbar"><div><h2>Existencias</h2><p>Stock actual y mínimo de cada insumo</p></div><label className="search-field search-field-small"><Icon name="search" size={18} /><input type="search" placeholder="Buscar insumo…" value={search} onChange={(e) => setSearch(e.target.value)} /></label></div>
          {filteredItems.length === 0 ? <div className="empty-panel"><Icon name="box" size={30} /><h3>Sin insumos</h3><p>Crea el primer insumo para empezar a controlar stock.</p><button type="button" className="btn btn-primary" onClick={() => setItemModal({ open: true, item: null })}>Nuevo insumo</button></div> : (
            <div className="inventory-list">
              {filteredItems.map((item) => (
                <article key={item.id} className={`inventory-row ${item.lowStock ? 'is-low' : ''} ${item.active ? '' : 'is-inactive'}`}>
                  <span className="inventory-icon"><Icon name="box" size={18} /></span>
                  <div className="inventory-main"><strong>{item.name}</strong><span>{item.sku || 'Sin SKU'} · mínimo {quantity(item.minQuantity)} {UNIT_LABELS[item.unit]}</span></div>
                  <div className="inventory-stock"><span>Stock actual</span><strong className={item.lowStock ? 'text-danger' : ''}>{quantity(item.currentQuantity)} {UNIT_LABELS[item.unit]}</strong>{item.lowStock ? <small>Stock bajo</small> : null}</div>
                  <div className="inventory-actions">
                    <button type="button" className="btn btn-small btn-primary" onClick={() => setReceiveModal({ open: true, item })}>Recibir</button>
                    <button type="button" className="btn btn-small btn-secondary" onClick={() => setAdjustModal({ open: true, item })}>Ajustar</button>
                    <button type="button" className="icon-button" onClick={() => setMovementsModal({ open: true, item })} aria-label="Ver movimientos"><Icon name="history" size={16} /></button>
                    <button type="button" className="icon-button" onClick={() => setItemModal({ open: true, item })} aria-label="Editar insumo"><Icon name="edit" size={16} /></button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="panel inventory-panel">
          <div className="admin-toolbar"><div><h2>Recetas por producto</h2><p>Al cobrar un pedido se descuentan estos ingredientes</p></div></div>
          <div className="recipe-list">
            {recipes.map((recipe) => (
              <div key={recipe.productId} className="recipe-row">
                <div className="recipe-product"><strong>{recipe.productName}</strong><span>{recipe.categoryName}</span></div>
                <div className="recipe-ingredients">{recipe.ingredients.length === 0 ? <span className="field-hint">Sin receta · no descuenta inventario</span> : recipe.ingredients.map((ingredient) => <span key={ingredient.inventoryItemId} className="recipe-chip">{quantity(ingredient.quantity)} {UNIT_LABELS[ingredient.unit]} {ingredient.itemName}</span>)}</div>
                <button type="button" className="btn btn-small btn-secondary" onClick={() => setRecipeModal({ open: true, recipe })}><Icon name="edit" size={16} /> {recipe.ingredients.length ? 'Editar' : 'Crear receta'}</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <ItemModal open={itemModal.open} item={itemModal.item} onClose={() => setItemModal({ open: false, item: null })} onSubmit={saveItem} />
      <ReceiveModal open={receiveModal.open} item={receiveModal.item} items={items} onClose={() => setReceiveModal({ open: false, item: null })} onSubmit={receive} />
      <AdjustModal open={adjustModal.open} item={adjustModal.item} onClose={() => setAdjustModal({ open: false, item: null })} onSubmit={adjust} />
      <MovementsModal open={movementsModal.open} item={movementsModal.item} onClose={() => setMovementsModal({ open: false, item: null })} />
      <RecipeModal open={recipeModal.open} recipe={recipeModal.recipe} items={items} onClose={() => setRecipeModal({ open: false, recipe: null })} onSubmit={saveRecipe} />
      {toast ? <div className={`toast toast-${toast.type}`}>{toast.message}</div> : null}
    </div>
  );
}

export default function InventoryPage() {
  return <FeatureGate feature="inventory"><InventoryPageContent /></FeatureGate>;
}
