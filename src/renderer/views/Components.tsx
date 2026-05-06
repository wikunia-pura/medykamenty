import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import type { PackagingComponent, Supplier, ComponentType } from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import SupplierMultiPicker from '../components/SupplierMultiPicker';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import { IconEdit, IconTrash, IconPlus, IconStar, IconClose } from '../components/Icons';
import ExportImportButtons from '../components/ExportImportButtons';
import {
  exportComponentsCsv,
  importComponentsCsv,
  saveFile,
  openFile,
  formatStats,
} from '../utils/exportImport';

const TYPES: ComponentType[] = [
  'tube',
  'bottle',
  'jar',
  'label',
  'cap',
  'pump',
  'pipette',
  'box',
  'leaflet',
  'other',
];

const Components: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<PackagingComponent[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Partial<PackagingComponent> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PackagingComponent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const reload = async () => {
    const [list, ss] = await Promise.all([
      window.electronAPI.listComponents(),
      window.electronAPI.listSuppliers(),
    ]);
    setItems(list);
    setSuppliers(ss);
  };

  useEffect(() => {
    void reload();
  }, []);

  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? '—';

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items.filter((c) => {
      const supplierNames = (c.supplierIds ?? [])
        .map((id) => suppliers.find((s) => s.id === id)?.name ?? '')
        .join(' ');
      return matchesQuery({ ...c, supplierNames }, query);
    });
  }, [items, suppliers, query]);

  const onAdd = () =>
    setEditing({
      name: '',
      type: 'other',
      supplierIds: [],
    });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const payload = {
      name: editing.name.trim(),
      type: (editing.type ?? 'other') as ComponentType,
      mpFirmaSymbol: editing.mpFirmaSymbol?.trim() || undefined,
      supplierIds: editing.supplierIds ?? [],
      preferredSupplierId: editing.preferredSupplierId,
      moq: editing.moq,
      leadTimeDays: editing.leadTimeDays,
      lastPurchasePriceNet: editing.lastPurchasePriceNet,
      currency: editing.currency?.trim() || undefined,
      notes: editing.notes?.trim() || undefined,
    };
    try {
      if (editing.id) {
        await window.electronAPI.updateComponent(editing.id, payload);
      } else {
        await window.electronAPI.createComponent(payload);
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
      const { content, filename } = exportComponentsCsv(items, suppliers);
      await saveFile(filename, content, 'csv');
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const r = await openFile('csv');
      if (!r.ok || !r.content) return;
      try {
        const stats = await importComponentsCsv(r.content, [...items], suppliers);
        setInfo(formatStats(stats));
        await reload();
      } catch (err) {
        setError(`${t.importInvalidFile}: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (c: PackagingComponent) => {
    setConfirmDelete(null);
    const result = await window.electronAPI.deleteComponent(c.id);
    if (!result.ok) {
      setError(`${t.error}: ${result.blockedBy?.join(', ') ?? ''}`);
    } else {
      await reload();
    }
  };

  const renderSupplierChips = (c: PackagingComponent) => {
    const ids = c.supplierIds ?? [];
    if (ids.length === 0) return <span className="hint">—</span>;
    const ordered = [
      ...(c.preferredSupplierId && ids.includes(c.preferredSupplierId)
        ? [c.preferredSupplierId]
        : []),
      ...ids.filter((id) => id !== c.preferredSupplierId),
    ];
    return (
      <span className="supplier-chips">
        {ordered.map((id) => {
          const isPreferred = id === c.preferredSupplierId;
          return (
            <span
              key={id}
              className={`supplier-chip ${isPreferred ? 'preferred' : ''}`}
              title={isPreferred ? t.preferredSupplier : undefined}
            >
              {isPreferred && (
                <span className="supplier-chip-star">
                  <IconStar size={11} />
                </span>
              )}
              {supplierName(id)}
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div className="main">
      <div className="page-header">
        <h1>{t.components}</h1>
        <span className="page-header-count">({items.length})</span>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-actions">
            <button className="btn primary" onClick={onAdd}>
              <IconPlus size={14} /> {t.add}
            </button>
            <ExportImportButtons
              format="csv"
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
                <th className="col-w-lg">{t.name}</th>
                <th className="col-w-md">{t.symbol}</th>
                <th className="col-w-sm">Typ</th>
                <th className="col-w-xl">{t.suppliers}</th>
                <th className="num col-w-sm">{t.moq}</th>
                <th className="num col-w-sm">{t.price}</th>
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
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="col-name col-wrap">{c.name}</td>
                  <td>{c.mpFirmaSymbol ?? ''}</td>
                  <td>{c.type}</td>
                  <td className="col-wrap">{renderSupplierChips(c)}</td>
                  <td className="num">{c.moq ?? ''}</td>
                  <td className="num">{c.lastPurchasePriceNet ?? ''}</td>
                  <td className="actions">
                    <div className="btn-row">
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={() => setEditing(c)}
                        title={t.edit}
                      >
                        <IconEdit size={13} /> {t.edit}
                      </button>
                      <button
                        className="btn btn-sm soft-danger"
                        onClick={() => setConfirmDelete(c)}
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
          <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-text">
                <h2 className="modal-title">
                  {editing.id ? `${t.edit}: ${editing.name ?? ''}` : `${t.add} — ${t.components.toLowerCase()}`}
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
            <div className="form-row">
              <label>{t.name}</label>
              <input
                className="input"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>Typ</label>
              <select
                value={editing.type ?? 'other'}
                onChange={(e) => setEditing({ ...editing, type: e.target.value as ComponentType })}
              >
                {TYPES.map((tt) => (
                  <option key={tt} value={tt}>
                    {tt}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>{t.symbol}</label>
              <input
                className="input"
                value={editing.mpFirmaSymbol ?? ''}
                onChange={(e) => setEditing({ ...editing, mpFirmaSymbol: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>{t.suppliers}</label>
              <SupplierMultiPicker
                suppliers={suppliers}
                selectedIds={editing.supplierIds ?? []}
                preferredId={editing.preferredSupplierId}
                onChange={(ids, pref) =>
                  setEditing({ ...editing, supplierIds: ids, preferredSupplierId: pref })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.moq}</label>
              <input
                className="input"
                type="number"
                value={editing.moq ?? ''}
                onChange={(e) =>
                  setEditing({ ...editing, moq: e.target.value === '' ? undefined : Number(e.target.value) })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.leadTime}</label>
              <input
                className="input"
                type="number"
                value={editing.leadTimeDays ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    leadTimeDays: e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.price}</label>
              <input
                className="input"
                type="number"
                step="0.01"
                value={editing.lastPurchasePriceNet ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    lastPurchasePriceNet:
                      e.target.value === '' ? undefined : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.currency}</label>
              <input
                className="input"
                placeholder="PLN"
                value={editing.currency ?? ''}
                onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
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

export default Components;
