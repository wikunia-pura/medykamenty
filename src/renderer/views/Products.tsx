import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  Product,
  RawMaterial,
  PackagingComponent,
} from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import { IconEdit, IconTrash, IconPlus, IconDuplicate } from '../components/Icons';
import HoverTooltip from '../components/HoverTooltip';
import ExportImportButtons from '../components/ExportImportButtons';
import ProductEditorModal from '../components/ProductEditorModal';
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
  const [editingReadOnly, setEditingReadOnly] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const closeEditor = () => {
    setEditing(null);
    setEditingReadOnly(false);
  };

  const openPreview = (p: Product) => {
    setEditing(p);
    setEditingReadOnly(true);
  };

  const COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.name, required: true },
      { id: 'sku', label: 'SKU', defaultVisible: true },
      { id: 'capacity', label: t.capacityMl, defaultVisible: true },
      { id: 'density', label: t.density, defaultVisible: true },
      { id: 'labor', label: t.laborCost, defaultVisible: false },
      { id: 'ingredients', label: t.ingredients, defaultVisible: true },
      { id: 'packaging', label: t.packaging, defaultVisible: true },
      { id: 'notes', label: t.notes, defaultVisible: false },
    ],
    [t],
  );
  const {
    isVisible,
    toggle,
    reorder,
    reset: resetColumns,
    orderedColumns,
    orderedVisibleIds,
  } = useColumnPrefs('products', COLUMNS);

  const headerFor = (id: string): React.ReactNode => {
    switch (id) {
      case 'name':
        return <th key={id} className="col-w-xl">{t.name}</th>;
      case 'sku':
        return <th key={id} className="col-w-md">SKU</th>;
      case 'capacity':
        return <th key={id} className="num col-w-sm">{t.capacityMl}</th>;
      case 'density':
        return <th key={id} className="num col-w-sm">{t.density}</th>;
      case 'labor':
        return <th key={id} className="num col-w-sm">{t.laborCost}</th>;
      case 'ingredients':
        return <th key={id} className="num col-w-sm">{t.ingredients}</th>;
      case 'packaging':
        return <th key={id} className="num col-w-sm">{t.packaging}</th>;
      case 'notes':
        return <th key={id} className="col-w-lg">{t.notes}</th>;
      default:
        return null;
    }
  };

  const rawName = (id: string) =>
    rawMaterials.find((r) => r.id === id)?.name ?? '?';
  const componentName = (id: string) =>
    components.find((c) => c.id === id)?.name ?? '?';

  const cellFor = (id: string, p: Product): React.ReactNode => {
    switch (id) {
      case 'name':
        return <td key={id} className="col-name col-wrap">{p.name}</td>;
      case 'sku':
        return <td key={id}>{p.sku ?? ''}</td>;
      case 'capacity':
        return <td key={id} className="num">{p.capacityMl}</td>;
      case 'density':
        return <td key={id} className="num">{p.densityGPerMl}</td>;
      case 'labor':
        return <td key={id} className="num">{p.conversionLaborCost ?? ''}</td>;
      case 'ingredients': {
        const ing = p.ingredients ?? [];
        if (ing.length === 0) {
          return <td key={id} className="num"><span className="hint">0</span></td>;
        }
        const top = ing.slice(0, 10);
        return (
          <td key={id} className="num">
            <HoverTooltip
              align="right"
              triggerClassName="count-bubble"
              trigger={ing.length}
            >
              <div className="shortage-tooltip-header">
                {t.ingredients} — {ing.length}
              </div>
              <ul className="shortage-tooltip-list">
                {top.map((it, i) => (
                  <li key={`${it.rawMaterialId}-${i}`}>
                    <span className="shortage-tooltip-name">
                      {rawName(it.rawMaterialId)}
                    </span>
                    <span className="list-tooltip-amount">
                      {(it.percentage ?? 0).toLocaleString()} %
                    </span>
                  </li>
                ))}
              </ul>
              {ing.length > top.length && (
                <div className="shortage-tooltip-more hint">
                  + {ing.length - top.length}
                </div>
              )}
            </HoverTooltip>
          </td>
        );
      }
      case 'packaging': {
        const pkg = p.packaging ?? [];
        if (pkg.length === 0) {
          return <td key={id} className="num"><span className="hint">0</span></td>;
        }
        const top = pkg.slice(0, 10);
        return (
          <td key={id} className="num">
            <HoverTooltip
              align="right"
              triggerClassName="count-bubble"
              trigger={pkg.length}
            >
              <div className="shortage-tooltip-header">
                {t.packaging} — {pkg.length}
              </div>
              <ul className="shortage-tooltip-list">
                {top.map((pp, i) => (
                  <li key={`${pp.componentId}-${i}`}>
                    <span className="shortage-tooltip-name">
                      {componentName(pp.componentId)}
                    </span>
                    <span className="list-tooltip-amount">
                      {(pp.qtyPerUnit ?? 0).toLocaleString()} szt./op.
                    </span>
                  </li>
                ))}
              </ul>
              {pkg.length > top.length && (
                <div className="shortage-tooltip-more hint">
                  + {pkg.length - top.length}
                </div>
              )}
            </HoverTooltip>
          </td>
        );
      }
      case 'notes':
        return <td key={id} className="col-wrap">{p.notes ?? ''}</td>;
      default:
        return null;
    }
  };

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

  const onAdd = () => {
    setEditingReadOnly(false);
    setEditing({
      name: '',
      capacityMl: 100,
      densityGPerMl: 1.0,
      ingredients: [],
      packaging: [],
      archived: false,
    });
  };

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
      closeEditor();
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
    setEditingReadOnly(false);
    setEditing(copy);
    await reload();
  };

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.products}</h1>
        <span className="page-header-count">{items.length}</span>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-actions">
            <ExportImportButtons
              format="json"
              onExport={onExport}
              onImport={onImport}
              busy={busy}
            />
            <ColumnPicker
              columns={orderedColumns}
              isVisible={isVisible}
              toggle={toggle}
              reorder={reorder}
              reset={resetColumns}
            />
            <button className="btn primary toolbar-action-primary" onClick={onAdd}>
              <IconPlus size={14} /> {t.add}
            </button>
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
                {orderedVisibleIds.map((id) => headerFor(id))}
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={orderedVisibleIds.length + 1} className="hint">
                    {query ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="row-clickable"
                  onClick={() => openPreview(p)}
                  title={t.preview}
                >
                  {orderedVisibleIds.map((id) => cellFor(id, p))}
                  <td
                    className="actions actions-sticky"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <div className="btn-row">
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={() => {
                          setEditingReadOnly(false);
                          setEditing(p);
                        }}
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
        <ProductEditorModal
          editing={editing}
          rawMaterials={rawMaterials}
          components={components}
          setEditing={setEditing}
          onCancel={closeEditor}
          onSave={onSave}
          error={error}
          readOnly={editingReadOnly}
          onEnterEdit={() => setEditingReadOnly(false)}
        />
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
