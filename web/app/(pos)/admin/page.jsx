'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import ProductModal from '@/components/admin/ProductModal';
import CategoryModal from '@/components/admin/CategoryModal';
import BulkImportModal from '@/components/admin/BulkImportModal';

function StatusBadge({ active }) {
  return (
    <span className={`status-badge ${active ? 'is-active' : 'is-inactive'}`}>
      <span className="status-dot" aria-hidden="true" />
      {active ? 'Disponible' : 'No disponible'}
    </span>
  );
}

function AdminSkeleton() {
  return (
    <div className="admin-skeleton" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="admin-row skeleton-card">
          <div>
            <div className="skeleton-line title" />
            <div className="skeleton-line medium" />
          </div>
          <div className="skeleton-line short" />
          <div className="skeleton-line medium" />
        </div>
      ))}
    </div>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState('products');
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('all');
  const [productModal, setProductModal] = useState({ open: false, product: null });
  const [categoryModal, setCategoryModal] = useState({ open: false, category: null });
  const [importOpen, setImportOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [toast, setToast] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [categoriesResponse, productsResponse] = await Promise.all([
        api.getAdminCategories(),
        api.getAdminProducts(),
      ]);
      setCategories(categoriesResponse.categories);
      setProducts(productsResponse.products);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'No se pudo cargar la administración del menú.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es');
    const byCategory = productCategoryFilter === 'all'
      ? products
      : products.filter((product) => product.categoryId === productCategoryFilter);
    if (!query) return byCategory;
    return byCategory.filter(
      (product) =>
        product.name.toLocaleLowerCase('es').includes(query) ||
        product.categoryName.toLocaleLowerCase('es').includes(query) ||
        product.description.toLocaleLowerCase('es').includes(query),
    );
  }, [products, search, productCategoryFilter]);

  const activeProducts = products.filter((product) => product.active).length;
  const activeCategories = categories.filter((category) => category.active).length;
  const productGroups = useMemo(() => {
    const known = new Set(categories.map((category) => category.id));
    const groups = categories
      .map((category) => ({
        category,
        products: filteredProducts.filter((product) => product.categoryId === category.id),
      }))
      .filter((group) => group.products.length > 0);
    const orphans = filteredProducts.filter((product) => !known.has(product.categoryId));
    if (orphans.length > 0) {
      groups.push({ category: { id: 'orphans', name: 'Sin categoría', active: false }, products: orphans });
    }
    return groups;
  }, [categories, filteredProducts]);

  async function saveProduct(payload, imageAction = {}) {
    let saved;
    if (productModal.product) {
      const response = await api.updateProduct(productModal.product.id, payload);
      saved = response.product;
    } else {
      const response = await api.createProduct(payload);
      saved = response.product;
    }
    let imageWarning = '';
    if (imageAction.imageFile) {
      try {
        const imageResponse = await api.uploadProductImage(saved.id, imageAction.imageFile);
        saved = imageResponse.product;
      } catch (imageError) {
        imageWarning = imageError.message || 'No se pudo subir la foto.';
      }
    } else if (imageAction.removeImage && saved.imageUrl) {
      try {
        await api.deleteProductImage(saved.id);
        saved = { ...saved, imageUrl: null };
      } catch (imageError) {
        imageWarning = imageError.message || 'No se pudo quitar la foto.';
      }
    }
    if (imageWarning) setToast({ type: 'error', message: imageWarning });
    if (productModal.product) {
      setProducts((previous) => previous.map((product) => (product.id === saved.id ? saved : product)));
      setToast({ type: 'success', message: `Producto “${saved.name}” actualizado.` });
    } else {
      setProducts((previous) => [...previous, saved]);
      setToast({ type: 'success', message: `Producto “${saved.name}” creado.` });
    }
  }

  async function saveCategory(payload) {
    if (categoryModal.category) {
      const response = await api.updateCategory(categoryModal.category.id, payload);
      setCategories((previous) =>
        previous.map((category) => (category.id === response.category.id ? response.category : category)),
      );
      setProducts((previous) =>
        previous.map((product) =>
          product.categoryId === response.category.id
            ? { ...product, categoryName: response.category.name }
            : product,
        ),
      );
      setToast({ type: 'success', message: `Categoría “${response.category.name}” actualizada.` });
    } else {
      const response = await api.createCategory(payload);
      setCategories((previous) => [...previous, response.category]);
      setToast({ type: 'success', message: `Categoría “${response.category.name}” creada.` });
    }
  }

  async function toggleProduct(product) {
    setBusyId(`product-${product.id}`);
    try {
      const response = await api.updateProduct(product.id, { active: !product.active });
      setProducts((previous) =>
        previous.map((item) => (item.id === response.product.id ? response.product : item)),
      );
      setToast({
        type: 'success',
        message: `“${response.product.name}” ${response.product.active ? 'activado' : 'desactivado'} del menú.`,
      });
    } catch (toggleError) {
      setToast({ type: 'error', message: toggleError?.message || 'No se pudo cambiar la disponibilidad.' });
    } finally {
      setBusyId('');
    }
  }

  async function toggleCategory(category) {
    setBusyId(`category-${category.id}`);
    try {
      const response = await api.updateCategory(category.id, { active: !category.active });
      setCategories((previous) =>
        previous.map((item) => (item.id === response.category.id ? response.category : item)),
      );
      setToast({
        type: 'success',
        message: response.category.active
          ? `Categoría “${response.category.name}” activada.`
          : `Categoría “${response.category.name}” desactivada. Sus productos se ocultan del POS.`,
      });
    } catch (toggleError) {
      setToast({ type: 'error', message: toggleError?.message || 'No se pudo cambiar la categoría.' });
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="admin-page">
      <div className="page-heading admin-heading">
        <div>
          <span className="eyebrow">Configuración</span>
          <h1>Administración del menú</h1>
          <p>Crea, edita y desactiva productos y categorías. Los cambios se reflejan en el punto de venta.</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={19} />
            Carga masiva
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setCategoryModal({ open: true, category: null })}
          >
            <Icon name="plus" size={19} />
            Nueva categoría
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setProductModal({ open: true, product: null })}
          >
            <Icon name="plus" size={19} />
            Nuevo producto
          </button>
        </div>
      </div>

      {error ? (
        <div className="alert alert-error" role="alert">
          <Icon name="alert" size={20} />
          <div>
            <strong>No se pudo cargar la administración</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="btn btn-small btn-secondary" onClick={() => void loadData()}>
            Reintentar
          </button>
        </div>
      ) : null}

      <div className="admin-tabs" role="tablist" aria-label="Secciones de administración">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'products'}
          className={tab === 'products' ? 'is-active' : ''}
          onClick={() => setTab('products')}
        >
          <Icon name="tag" size={19} />
          Productos
          <span className="tab-count">{products.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'categories'}
          className={tab === 'categories' ? 'is-active' : ''}
          onClick={() => setTab('categories')}
        >
          <Icon name="admin" size={19} />
          Categorías
          <span className="tab-count">{categories.length}</span>
        </button>
        <button type="button" className="admin-refresh" onClick={() => void loadData()} disabled={loading}>
          <Icon name="refresh" size={17} className={loading ? 'spin' : ''} />
          Recargar
        </button>
      </div>

      {loading ? (
        <AdminSkeleton />
      ) : tab === 'products' ? (
        <section className="panel admin-panel" aria-labelledby="products-admin-title">
          <div className="admin-toolbar">
            <div>
              <h2 id="products-admin-title">Productos</h2>
              <p>
                {activeProducts} disponibles · {products.length - activeProducts} {(products.length - activeProducts) === 1 ? 'agotado' : 'agotados'}
              </p>
            </div>
            <div className="toolbar-right">
              <label className="search-field search-field-small">
                <Icon name="search" size={18} />
                <input
                  type="search"
                  placeholder="Buscar producto…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Buscar producto"
                />
              </label>
            </div>
          </div>

          <div className="admin-category-filter category-strip" role="tablist" aria-label="Filtrar productos por categoría">
            <button type="button" role="tab" aria-selected={productCategoryFilter === 'all'} className={`category-chip ${productCategoryFilter === 'all' ? 'is-active' : ''}`} onClick={() => setProductCategoryFilter('all')}>
              Todos <span>{products.length}</span>
            </button>
            {categories.map((category) => {
              const count = products.filter((product) => product.categoryId === category.id).length;
              return (
                <button key={category.id} type="button" role="tab" aria-selected={productCategoryFilter === category.id} className={`category-chip ${productCategoryFilter === category.id ? 'is-active' : ''}`} onClick={() => setProductCategoryFilter(category.id)}>
                  {category.name} <span>{count}</span>
                </button>
              );
            })}
          </div>

          {filteredProducts.length === 0 ? (
            <div className="empty-panel">
              <Icon name="tag" size={30} />
              <h3>No hay productos que coincidan</h3>
              <p>Cambia la búsqueda o crea un producto nuevo.</p>
            </div>
          ) : (
            <div className="admin-product-groups">
              {productGroups.map((group) => (
                <section key={group.category.id} className="admin-category-group">
                  <header className="admin-category-group-head">
                    <div>
                      <h3>{group.category.name}</h3>
                      <span>{group.products.length} {group.products.length === 1 ? 'producto' : 'productos'}</span>
                    </div>
                    {group.category.id !== 'orphans' && group.category.active === false ? <span className="status-badge is-inactive">Categoría inactiva</span> : null}
                  </header>
                  <div className="admin-product-list">
                    {group.products.map((product) => (
                      <article key={product.id} className={`admin-row admin-product-row ${product.active ? '' : 'is-inactive'}`}>
                        <div className="admin-product-main">
                          {product.imageUrl ? <img className="admin-product-thumb" src={product.imageUrl} alt="" /> : null}
                          <div className="admin-product-copy">
                            <div className="admin-product-tags">
                              <StatusBadge active={product.active} />
                            </div>
                            <h3>{product.name}</h3>
                            {product.description ? <p>{product.description}</p> : null}
                          </div>
                        </div>
                        <div className="admin-product-price">
                          <span>Precio</span>
                          <strong>{formatMoney(product.priceCents)}</strong>
                        </div>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="btn btn-small btn-secondary"
                            onClick={() => setProductModal({ open: true, product })}
                          >
                            <Icon name="edit" size={16} />
                            Editar
                          </button>
                          <button
                            type="button"
                            className={`btn btn-small ${product.active ? 'btn-danger-quiet' : 'btn-success-quiet'}`}
                            onClick={() => void toggleProduct(product)}
                            disabled={busyId === `product-${product.id}`}
                          >
                            {busyId === `product-${product.id}` ? (
                              <span className="spinner spinner-small" aria-hidden="true" />
                            ) : null}
                            {product.active ? 'Desactivar' : 'Activar'}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
          <p className="admin-footnote">
            <Icon name="note" size={15} />
            Los productos se desactivan en lugar de eliminarse para conservar el historial de ventas.
          </p>
        </section>
      ) : (
        <section className="panel admin-panel" aria-labelledby="categories-admin-title">
          <div className="admin-toolbar">
            <div>
              <h2 id="categories-admin-title">Categorías</h2>
              <p>
                {activeCategories} activas · {categories.length - activeCategories} inactivas
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setCategoryModal({ open: true, category: null })}
            >
              <Icon name="plus" size={18} />
              Nueva categoría
            </button>
          </div>

          {categories.length === 0 ? (
            <div className="empty-panel">
              <Icon name="admin" size={30} />
              <h3>Aún no hay categorías</h3>
              <p>Crea la primera categoría para organizar el menú.</p>
            </div>
          ) : (
            <div className="category-admin-grid">
              {categories.map((category) => {
                const count = products.filter((product) => product.categoryId === category.id).length;
                return (
                  <article key={category.id} className={`category-card ${category.active ? '' : 'is-inactive'}`}>
                    <div className="category-card-top">
                      <span className="category-icon">
                        <Icon name="tag" size={21} />
                      </span>
                      <StatusBadge active={category.active} />
                    </div>
                    <h3>{category.name}</h3>
                    <p>{category.description || 'Sin descripción'}</p>
                    <div className="category-card-meta">
                      <span>{count} {count === 1 ? 'producto' : 'productos'}</span>
                      <span>Orden {category.sortOrder}</span>
                    </div>
                    <div className="category-card-actions">
                      <button
                        type="button"
                        className="btn btn-small btn-secondary"
                        onClick={() => setCategoryModal({ open: true, category })}
                      >
                        <Icon name="edit" size={16} />
                        Editar
                      </button>
                      <button
                        type="button"
                        className={`btn btn-small ${category.active ? 'btn-danger-quiet' : 'btn-success-quiet'}`}
                        onClick={() => void toggleCategory(category)}
                        disabled={busyId === `category-${category.id}`}
                      >
                        {busyId === `category-${category.id}` ? (
                          <span className="spinner spinner-small" aria-hidden="true" />
                        ) : null}
                        {category.active ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          <p className="admin-footnote">
            <Icon name="alert" size={15} />
            Al desactivar una categoría, todos sus productos dejan de mostrarse en el POS.
          </p>
        </section>
      )}

      <BulkImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={loadData} />
      <ProductModal
        open={productModal.open}
        product={productModal.product}
        categories={categories}
        onClose={() => setProductModal({ open: false, product: null })}
        onSubmit={saveProduct}
      />
      <CategoryModal
        open={categoryModal.open}
        category={categoryModal.category}
        onClose={() => setCategoryModal({ open: false, category: null })}
        onSubmit={saveCategory}
      />

      {toast ? (
        <div className={`toast toast-${toast.type}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
