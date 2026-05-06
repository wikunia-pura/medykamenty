import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import type { RawMaterial, Supplier, Unit } from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import SupplierMultiPicker from '../components/SupplierMultiPicker';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import { IconEdit, IconTrash, IconPlus, IconStar, IconClose } from '../components/Icons';
import ExportImportButtons from '../components/ExportImportButtons';
import {
  exportRawMaterialsCsv,
  importRawMaterialsCsv,
  saveFile,
  openFile,
  formatStats,
} from '../utils/exportImport';

const UNITS: Unit[] = ['kg', 'g', 'l', 'ml'];

const RawMaterials: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Partial<RawMaterial> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RawMaterial | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');

  const reload = async () => {
    const [rms, ss] = await Promise.all([
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listSuppliers(),
    ]);
    setItems(rms);
    setSuppliers(ss);
  };

  useEffect(() => {
    void reload();
  }, []);

  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? '—';

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items.filter((rm) => {
      // Include resolved supplier names in the search corpus.
      const supplierNames = (rm.supplierIds ?? [])
        .map((id) => suppliers.find((s) => s.id === id)?.name ?? '')
        .join(' ');
      return matchesQuery({ ...rm, supplierNames }, query);
    });
  }, [items, suppliers, query]);

  const onAdd = () =>
    setEditing({
      name: '',
      unit: 'kg',
      supplierIds: [],
      factorySupplied: false,
    });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const payload = {
      name: editing.name.trim(),
      mpFirmaSymbol: editing.mpFirmaSymbol?.trim() || undefined,
      unit: (editing.unit ?? 'kg') as Unit,
      supplierIds: editing.supplierIds ?? [],
      preferredSupplierId: editing.preferredSupplierId,
      factorySupplied: !!editing.factorySupplied,
      moq: editing.moq,
      leadTimeDays: editing.leadTimeDays,
      shelfLifeMonths: editing.shelfLifeMonths,
      lastPurchasePriceNet: editing.lastPurchasePriceNet,
      currency: editing.currency?.trim() || undefined,
      notes: editing.notes?.trim() || undefined,
    };
    try {
      if (editing.id) {
        await window.electronAPI.updateRawMaterial(editing.id, payload);
      } else {
        await window.electronAPI.createRawMaterial(payload);
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
      const { content, filename } = exportRawMaterialsCsv(items, suppliers);
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
        const stats = await importRawMaterialsCsv(r.content, [...items], suppliers);
        setInfo(formatStats(stats));
        await reload();
      } catch (err) {
        setError(`${t.importInvalidFile}: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (rm: RawMaterial) => {
    setConfirmDelete(null);
    const result = await window.electronAPI.deleteRawMaterial(rm.id);
    if (!result.ok) {
      setError(`${t.error}: ${result.blockedBy?.join(', ') ?? ''}`);
    } else {
      await reload();
    }
  };

  const renderSupplierChips = (rm: RawMaterial) => {
    const ids = rm.supplierIds ?? [];
    if (ids.length === 0) return <span className="hint">—</span>;
    // Order: preferred first, then the rest in their stored order.
    const ordered = [
      ...(rm.preferredSupplierId && ids.includes(rm.preferredSupplierId)
        ? [rm.preferredSupplierId]
        : []),
      ...ids.filter((id) => id !== rm.preferredSupplierId),
    ];
    return (
      <span className="supplier-chips">
        {ordered.map((id) => {
          const isPreferred = id === rm.preferredSupplierId;
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
        <h1>{t.rawMaterials}</h1>
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
                <th className="col-w-sm">{t.unit}</th>
                <th className="col-w-xl">{t.suppliers}</th>
                <th className="num col-w-sm">{t.moq}</th>
                <th className="num col-w-sm">{t.leadTime}</th>
                <th className="col-w-sm">{t.factorySupplied}</th>
                <th className="actions">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="hint">
                    {query ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filtered.map((rm) => (
                <tr key={rm.id}>
                  <td className="col-name col-wrap">{rm.name}</td>
                  <td>{rm.mpFirmaSymbol ?? ''}</td>
                  <td>{rm.unit}</td>
                  <td className="col-wrap">{renderSupplierChips(rm)}</td>
                  <td className="num">{rm.moq ?? ''}</td>
                  <td className="num">{rm.leadTimeDays ?? ''}</td>
                  <td>{rm.factorySupplied ? <span className="tag warn">factory</span> : ''}</td>
                  <td className="actions">
                    <div className="btn-row">
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={() => setEditing(rm)}
                        title={t.edit}
                      >
                        <IconEdit size={13} /> {t.edit}
                      </button>
                      <button
                        className="btn btn-sm soft-danger"
                        onClick={() => setConfirmDelete(rm)}
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
                  {editing.id ? `${t.edit}: ${editing.name ?? ''}` : `${t.add} — ${t.rawMaterials.toLowerCase()}`}
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
              <label>{t.symbol}</label>
              <input
                className="input"
                value={editing.mpFirmaSymbol ?? ''}
                onChange={(e) => setEditing({ ...editing, mpFirmaSymbol: e.target.value })}
              />
            </div>
            <div className="form-row">
              <label>{t.unit}</label>
              <select
                value={editing.unit ?? 'kg'}
                onChange={(e) => setEditing({ ...editing, unit: e.target.value as Unit })}
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>{t.factorySupplied}</label>
              <input
                type="checkbox"
                checked={!!editing.factorySupplied}
                onChange={(e) => setEditing({ ...editing, factorySupplied: e.target.checked })}
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
              <label>{t.shelfLife}</label>
              <input
                className="input"
                type="number"
                value={editing.shelfLifeMonths ?? ''}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    shelfLifeMonths: e.target.value === '' ? undefined : Number(e.target.value),
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
                value={editing.currency ?? ''}
                placeholder="PLN"
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

export default RawMaterials;
