'use client';

import { useEffect, useState } from 'react';
import Modal from '@/components/Modal';

function messageFromError(error) {
  if (error?.details?.fields?.length) {
    return error.details.fields.map((field) => field.message).join(' ');
  }
  return error?.message || 'No se pudo guardar la categoría.';
}

export default function CategoryModal({ open, category, onClose, onSubmit }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setDescription(category?.description ?? '');
    setSortOrder(String(category?.sortOrder ?? 0));
    setActive(category?.active ?? true);
    setSubmitting(false);
    setError('');
  }, [open, category]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('El nombre de la categoría es obligatorio.');
      return;
    }
    if (name.trim().length > 60) {
      setError('El nombre no puede exceder 60 caracteres.');
      return;
    }
    if (description.length > 200) {
      setError('La descripción no puede exceder 200 caracteres.');
      return;
    }
    const orderNumber = Number(sortOrder);
    if (!Number.isInteger(orderNumber) || orderNumber < -9999 || orderNumber > 9999) {
      setError('El orden debe ser un número entero entre -9999 y 9999.');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        sortOrder: orderNumber,
        active,
      });
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
      title={category ? 'Editar categoría' : 'Nueva categoría'}
      subtitle={category ? category.name : 'Organiza el menú del punto de venta.'}
      size="sm"
      closeDisabled={submitting}
      footer={
        <div className="modal-actions">
          <span />
          <div className="modal-actions-right">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              Cancelar
            </button>
            <button type="submit" form="category-form" className="btn btn-primary" disabled={submitting}>
              {submitting ? <span className="spinner spinner-small" aria-hidden="true" /> : null}
              {category ? 'Guardar cambios' : 'Crear categoría'}
            </button>
          </div>
        </div>
      }
    >
      <form id="category-form" className="form-grid" onSubmit={handleSubmit}>
        <label className="field field-full">
          <span className="field-label">Nombre</span>
          <input
            id="category-name"
            name="name"
            type="text"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            required
            autoFocus
          />
        </label>

        <label className="field field-full">
          <span className="field-label">Descripción</span>
          <textarea
            id="category-description"
            name="description"
            className="input textarea"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={200}
          />
        </label>

        <label className="field">
          <span className="field-label">Orden</span>
          <input
            id="category-sort-order"
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
          <input id="category-active" name="active" type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          <span className="toggle-track" aria-hidden="true"><span /></span>
          <span>
            <strong>Categoría activa</strong>
            <small>Al desactivarla, sus productos se ocultan del POS.</small>
          </span>
        </label>

        {error ? <p className="form-error field-full" role="alert">{error}</p> : null}
      </form>
    </Modal>
  );
}
