'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';
import { centsToInput, parseMoneyToCents } from '@restpos/shared/money';
import Icon from '@/components/Icon';
import { compressImage, validateImageFile } from '@/lib/image';

function messageFromError(error) {
  if (error?.details?.fields?.length) {
    return error.details.fields.map((field) => field.message).join(' ');
  }
  return error?.message || 'No se pudo guardar el producto.';
}

export default function ProductModal({ open, product, categories, stations = [], onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [stationId, setStationId] = useState('');
  const [prepMinutes, setPrepMinutes] = useState('0');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [imageError, setImageError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(product?.name ?? '');
    setCategoryId(String(product?.categoryId ?? categories[0]?.id ?? ''));
    setDescription(product?.description ?? '');
    setPrice(product ? centsToInput(product.priceCents) : '');
    setSortOrder(String(product?.sortOrder ?? 0));
    setStationId(String(product?.stationId ?? ''));
    setPrepMinutes(String(Math.round((product?.prepSeconds ?? 0) / 60)));
    setActive(product?.active ?? true);
    setSubmitting(false);
    setError('');
    setImageFile(null);
    setImagePreview(product?.imageUrl ?? null);
    setRemoveImage(false);
    setImageError('');
  }, [open, product, categories]);

  async function selectImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const validation = validateImageFile(file);
    if (validation) { setImageError(validation); return; }
    setImageError('');
    const compressed = await compressImage(file);
    setImageFile(compressed);
    setImagePreview(URL.createObjectURL(compressed));
    setRemoveImage(false);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('El nombre del producto es obligatorio.');
      return;
    }
    if (name.trim().length > 80) {
      setError('El nombre no puede exceder 80 caracteres.');
      return;
    }
    if (!categoryId) {
      setError('Selecciona una categoría.');
      return;
    }
    if (description.length > 300) {
      setError('La descripción no puede exceder 300 caracteres.');
      return;
    }
    const orderNumber = Number(sortOrder);
    if (!Number.isInteger(orderNumber) || orderNumber < -9999 || orderNumber > 9999) {
      setError('El orden debe ser un número entero entre -9999 y 9999.');
      return;
    }
    let priceCents;
    try {
      priceCents = parseMoneyToCents(price);
    } catch (priceError) {
      setError(priceError.message);
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        categoryId: Number(categoryId),
        name: name.trim(),
        description: description.trim(),
        priceCents,
        sortOrder: orderNumber,
        stationId: stationId ? Number(stationId) : null,
        prepSeconds: Math.max(0, Number(prepMinutes) || 0) * 60,
        active,
      }, { imageFile, removeImage });
      onClose();
    } catch (submitError) {
      setError(messageFromError(submitError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={product ? 'Editar producto' : 'Nuevo producto'}
      subtitle={product ? product.name : 'Agrega un producto al catálogo.'}
      size="md"
      closeDisabled={submitting}
      footer={
        <div className="modal-actions">
          <span />
          <div className="modal-actions-right">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancelar
            </button>
            <button type="submit" form="product-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? <span className="spinner spinner-small" aria-hidden="true" /> : null}
              {product ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        </div>
      }
    >
      <form id="product-form" className="form-grid" onSubmit={handleSubmit}>
        <div className="field field-full product-image-field">
          <span className="field-label">Foto del producto <small className="field-hint">opcional</small></span>
          <div className="product-image-editor">
            <div className="product-image-preview">
              {imagePreview ? <img src={imagePreview} alt="Vista previa del producto" /> : <Icon name="tag" size={28} />}
            </div>
            <div className="product-image-actions">
              <label className="btn btn-small btn-secondary">
                <Icon name="plus" size={16} /> {imagePreview ? 'Cambiar foto' : 'Agregar foto'}
                <input type="file" accept="image/*" onChange={(event) => void selectImage(event)} />
              </label>
              {imagePreview ? (
                <button type="button" className="text-button text-danger" onClick={() => { setImageFile(null); setImagePreview(null); setRemoveImage(true); }}>
                  Quitar foto
                </button>
              ) : null}
              <span className="field-hint">JPG, PNG o WebP · se optimiza automáticamente.</span>
              {imageError ? <p className="field-error">{imageError}</p> : null}
            </div>
          </div>
        </div>

        <label className="field field-full">
          <span className="field-label">Nombre del producto</span>
          <input
            id="product-name"
            name="name"
            type="text"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span className="field-label">Categoría</span>
          <select id="product-category" name="categoryId" className="input select" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required>
            <option value="">Selecciona…</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.active ? '' : ' (inactiva)'}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Precio</span>
          <div className="money-input-wrap">
            <span className="money-prefix">₡</span>
            <input
              id="product-price"
              name="price"
              className="input money-input"
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="0.00"
              required
            />
          </div>
        </label>

        {stations.length > 0 ? (
          <>
            <label className="field">
              <span className="field-label">Estación de cocina</span>
              <select className="input select" value={stationId} onChange={(event) => setStationId(event.target.value)}>
                <option value="">Sin estación</option>
                {stations.filter((station) => station.active).map((station) => <option key={station.id} value={station.id}>{station.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Preparación <small className="field-hint">minutos</small></span>
              <input className="input" type="number" min={0} max={120} value={prepMinutes} onChange={(event) => setPrepMinutes(event.target.value)} />
            </label>
          </>
        ) : null}

        <label className="field field-full">
          <span className="field-label">Descripción</span>
          <textarea
            id="product-description"
            name="description"
            className="input textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            maxLength={300}
            placeholder="Ingredientes o descripción breve"
          />
          <span className="field-hint">{description.length}/300</span>
        </label>

        <label className="field">
          <span className="field-label">Orden en la categoría</span>
          <input
            id="product-sort-order"
            name="sortOrder"
            className="input"
            type="number"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            min={-9999}
            max={9999}
            step={1}
          />
          <span className="field-hint">Menor número aparece primero.</span>
        </label>

        <label className="toggle-row field">
          <input id="product-active" name="active" type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          <span>
            <strong>Disponible en el POS</strong>
            <small>Los productos no disponibles se muestran como agotados.</small>
          </span>
        </label>

        {error ? <p className="form-error field-full" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
