'use client';

import { useRef, useState } from 'react';
import Modal from '@/components/Modal';
import Icon from '@/components/Icon';
import { api } from '@/lib/api';

const TEMPLATE = 'categoria,nombre,descripcion,precio,activo,orden\nEntradas,Guacamole con totopos,Aguacate y totopos,89.00,si,10\nBebidas,Agua mineral,Botella 600 ml,35.00,si,10\n';

export default function BulkImportModal({ open, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  function reset() {
    setFile(null); setResult(null); setError(''); setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function close() { reset(); onClose(); }

  function downloadTemplate() {
    const blob = new Blob([`\uFEFF${TEMPLATE}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'plantilla-productos.csv'; link.click();
    URL.revokeObjectURL(url);
  }

  async function importFile() {
    if (!file) { setError('Selecciona un archivo CSV.'); return; }
    setBusy(true); setError(''); setResult(null);
    try {
      const response = await api.importProducts(file);
      setResult(response.result);
      await onImported?.();
    } catch (importError) {
      setError(importError.message || 'No se pudo importar el archivo.');
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Carga masiva de productos"
      subtitle="Importa o actualiza productos desde un archivo CSV."
      size="md"
      closeDisabled={busy}
      footer={<div className="modal-actions"><span /><div className="modal-actions-right"><button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>{result ? 'Cerrar' : 'Cancelar'}</button>{!result ? <button type="button" className="btn btn-primary" onClick={() => void importFile()} disabled={busy || !file}>{busy ? <span className="spinner spinner-small" /> : <Icon name="upload" size={18} />} Importar productos</button> : null}</div></div>}
    >
      <div className="bulk-import-body">
        <div className="bulk-import-help">
          <div><strong>Columnas requeridas</strong><p><code>categoria</code>, <code>nombre</code>, <code>descripcion</code>, <code>precio</code>, <code>activo</code>, <code>orden</code></p></div>
          <button type="button" className="btn btn-small btn-secondary" onClick={downloadTemplate}><Icon name="download" size={16} /> Descargar plantilla</button>
        </div>
        <label className="bulk-drop">
          <Icon name="upload" size={26} />
          <strong>{file ? file.name : 'Selecciona tu archivo CSV'}</strong>
          <span>{file ? `${(file.size / 1024).toFixed(1)} KB` : 'Arrastra o toca para buscar'}</span>
          <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(''); setResult(null); }} />
        </label>
        <p className="field-hint">Si la categoría no existe, se crea. Si el producto ya existe en la categoría, se actualiza. Los archivos se procesan completos o se reportan las filas con error.</p>
        {error ? <p className="form-error">{error}</p> : null}
        {result ? (
          <div className="bulk-result">
            <div className="alert alert-success"><Icon name="check" size={18} /><p>Proceso terminado: {result.created} creados, {result.updated} actualizados.</p></div>
            {result.errors.length > 0 ? <div className="bulk-errors"><strong>{result.errors.length} filas con error</strong>{result.errors.slice(0, 20).map((row) => <p key={`${row.line}-${row.message}`}>Línea {row.line}: {row.message}</p>)}</div> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
