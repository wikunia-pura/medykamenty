import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import type {
  Product,
  RawMaterial,
  PackagingComponent,
  RecipeIngredient,
  RecipePackaging,
} from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import RecipeEditor from '../components/RecipeEditor';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import { IconEdit, IconTrash, IconPlus, IconDuplicate, IconClose } from '../components/Icons';
import ExportImportButtons from '../components/ExportImportButtons';
import {
  exportProductsJson,
  importProductsJson,
  saveFile,
  openFile,
  formatStats,
} from '../utils/exportImport';

const Products: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => items.filter((p) => matchesQuery(p, query)),
    [items, query],
  );

  const reload = async () => {
    const [list, rms, cs] = await Promise.all([
      window.electronAPI.listProducts(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
    ]);
    setItems(list);
    setRawMaterials(rms);
    setComponents(cs);
  };

  useEffect(() => {
    void reload();
  }, []);

  const onAdd = () =>
    setEditing({
      name: '',
      capacityMl: 100,
      densityGPerMl: 1.0,
      ingredients: [],
      packaging: [],
      archived: false,
    });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const sumPercent = (editing.ingredients ?? []).reduce(
      (acc, i) => acc + (i.percentage || 0),
      0,
    );
    if (sumPercent > 100.0001) {
      setError(t.recipeSumError);
      return;
    }
    const payload = {
      name: editing.name.trim(),
      sku: editing.sku?.trim() || undefined,
      capacityMl: editing.capacityMl ?? 0,
      densityGPerMl: editing.densityGPerMl ?? 1,
      conversionLaborCost: editing.conversionLaborCost,
      ingredients: editing.ingredients ?? [],
      packaging: editing.packaging ?? [],
      notes: editing.notes?.trim() || undefined,
      archived: !!editing.archived,
    };
    try {
      if (editing.id) {
        await window.electronAPI.updateProduct(editing.id, payload);
      } else {
        await window.electronAPI.createProduct(payload);
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onExport = async () => {
    setError(null);
    setInfo(null);
    if (items.length === 0) {
      setInfo(t.exportEmpty);
      return;
    }
    setBusy(true);
    try {
      const { content, filename } = exportProductsJson(items, rawMaterials, components);
      await saveFile(filename, content, 'json');
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const r = await openFile('json');
      if (!r.ok || !r.content) return;
      try {
        const stats = await importProductsJson(
          r.content,
          [...items],
          rawMaterials,
          components,
        );
        setInfo(formatStats(stats));
        await reload();
      } catch (err) {
        setError(`${t.importInvalidFile}: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (p: Product) => {
    setConfirmDelete(null);
    await window.electronAPI.deleteProduct(p.id);
    await reload();
  };

  const onDuplicate = async (p: Product) => {
    const copy = await window.electronAPI.duplicateProduct(p.id);
    setEditing(copy);
    await reload();
  };

  return (
    <div className="main">
      <div className="page-header">
        <h1>{t.products}</h1>
        <span className="page-header-count">({items.length})</span>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-actions">
            <button className="btn primary" onClick={onAdd}>
              <IconPlus size={14} /> {t.add}
            </button>
            <ExportImportButtons
              format="json"
              onExport={onExport}
              onImport={onImport}
              busy={busy}
            />
          </div>
          <div className="toolbar-search">
            <SearchInput value={query} onChange={setQuery} block />
          </div>
        </div>
        {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
        {info && <div className="hint" style={{ marginBottom: 8 }}>{info}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-w-xl">{t.name}</th>
                <th className="col-w-md">SKU</th>
                <th className="num col-w-sm">{t.capacityMl}</th>
                <th className="num col-w-sm">{t.density}</th>
                <th className="num col-w-sm">{t.ingredients}</th>
                <th className="num col-w-sm">{t.packaging}</th>
                <th className="actions">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="hint">
                    {query ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td className="col-name col-wrap">{p.name}</td>
                  <td>{p.sku ?? ''}</td>
                  <td className="num">{p.capacityMl}</td>
                  <td className="num">{p.densityGPerMl}</td>
                  <td className="num">{p.ingredients.length}</td>
                  <td className="num">{p.packaging.length}</td>
                  <td className="actions">
                    <div className="btn-row">
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={() => setEditing(p)}
                        title={t.edit}
                      >
                        <IconEdit size={13} /> {t.edit}
                      </button>
                      <button
                        className="btn btn-sm soft-success"
                        onClick={() => onDuplicate(p)}
                        title={t.duplicate}
                      >
                        <IconDuplicate size={13} /> {t.duplicate}
                      </button>
                      <button
                        className="btn btn-sm soft-danger"
                        onClick={() => setConfirmDelete(p)}
                        title={t.delete}
                      >
                        <IconTrash size={13} /> {t.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h2 className="modal-title">
                  {editing.id ? `${t.edit}: ${editing.name ?? ''}` : `${t.add} — ${t.products.toLowerCase()}`}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setEditing(null)}
                title={t.close}
                aria-label={t.close}
              >
                <IconClose size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div className="modal-section">
                <div className="modal-section-header">
                  <h3 className="modal-section-title">Podstawowe dane</h3>
                </div>
                <div className="form-row">
                  <label>{t.name}</label>
                  <input
                    className="input"
                    value={editing.name ?? ''}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <label>SKU</label>
                  <input
                    className="input"
                    value={editing.sku ?? ''}
                    onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <label>{t.capacityMl}</label>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    value={editing.capacityMl ?? 0}
                    onChange={(e) => setEditing({ ...editing, capacityMl: Number(e.target.value) })}
                  />
                </div>
                <div className="form-row">
                  <label>{t.density}</label>
                  <input
                    className="input"
                    type="number"
                    step="0.001"
                    value={editing.densityGPerMl ?? 1}
                    onChange={(e) => setEditing({ ...editing, densityGPerMl: Number(e.target.value) })}
                  />
                </div>
                <div className="form-row">
                  <label>{t.laborCost}</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={editing.conversionLaborCost ?? ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        conversionLaborCost:
                          e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="form-row">
                  <label>{t.notes}</label>
                  <textarea
                    value={editing.notes ?? ''}
                    onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-section">
                <div className="modal-section-header">
                  <h3 className="modal-section-title">{t.ingredients} & {t.packaging}</h3>
                </div>
                <RecipeEditor
                  rawMaterials={rawMaterials}
                  components={components}
                  ingredients={editing.ingredients ?? []}
                  packaging={editing.packaging ?? []}
                  onIngredientsChange={(next: RecipeIngredient[]) =>
                    setEditing({ ...editing, ingredients: next })
                  }
                  onPackagingChange={(next: RecipePackaging[]) =>
                    setEditing({ ...editing, packaging: next })
                  }
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={() => setEditing(null)}>
                {t.cancel}
              </button>
              <button className="btn primary-filled" onClick={onSave}>
                {t.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`${t.delete}: ${confirmDelete.name}?`}
          onConfirm={() => onDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}
    </div>
  );
};

export default Products;
