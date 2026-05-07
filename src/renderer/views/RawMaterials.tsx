import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type { RawMaterial, Supplier, Unit } from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import SupplierMultiPicker from '../components/SupplierMultiPicker';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import { IconEdit, IconTrash, IconPlus, IconStar } from '../components/Icons';
import ModalHeader from '../components/ModalHeader';
import ExportImportButtons from '../components/ExportImportButtons';
import { useEscapeKey } from '../utils/useEscapeKey';
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

  useEscapeKey(() => setEditing(null), !!editing);

  const COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.name, required: true },
      { id: 'symbol', label: t.symbol, defaultVisible: true },
      { id: 'unit', label: t.unit, defaultVisible: true },
      { id: 'suppliers', label: t.suppliers, defaultVisible: true },
      { id: 'moq', label: t.moq, defaultVisible: true },
      { id: 'leadTime', label: t.leadTime, defaultVisible: true },
      { id: 'shelfLife', label: t.shelfLife, defaultVisible: false },
      { id: 'price', label: t.price, defaultVisible: false },
      { id: 'currency', label: t.currency, defaultVisible: false },
      { id: 'factory', label: t.factorySupplied, defaultVisible: true },
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
  } = useColumnPrefs('rawMaterials', COLUMNS);

  const headerFor = (id: string): React.ReactNode => {
    switch (id) {
      case 'name':
        return <th key={id} className="col-w-lg">{t.name}</th>;
      case 'symbol':
        return <th key={id} className="col-w-md">{t.symbol}</th>;
      case 'unit':
        return <th key={id} className="col-w-sm">{t.unit}</th>;
      case 'suppliers':
        return <th key={id} className="col-w-xl">{t.suppliers}</th>;
      case 'moq':
        return <th key={id} className="num col-w-sm">{t.moq}</th>;
      case 'leadTime':
        return <th key={id} className="num col-w-sm">{t.leadTime}</th>;
      case 'shelfLife':
        return <th key={id} className="num col-w-sm">{t.shelfLife}</th>;
      case 'price':
        return <th key={id} className="num col-w-sm">{t.price}</th>;
      case 'currency':
        return <th key={id} className="col-w-sm">{t.currency}</th>;
      case 'factory':
        return <th key={id} className="col-w-sm">{t.factorySupplied}</th>;
      case 'notes':
        return <th key={id} className="col-w-lg">{t.notes}</th>;
      default:
        return null;
    }
  };

  const cellFor = (id: string, rm: RawMaterial): React.ReactNode => {
    switch (id) {
      case 'name':
        return <td key={id} className="col-name col-wrap">{rm.name}</td>;
      case 'symbol':
        return <td key={id}>{rm.mpFirmaSymbol ?? ''}</td>;
      case 'unit':
        return <td key={id}>{rm.unit}</td>;
      case 'suppliers':
        return <td key={id} className="col-wrap">{renderSupplierChips(rm)}</td>;
      case 'moq':
        return <td key={id} className="num">{rm.moq ?? ''}</td>;
      case 'leadTime':
        return <td key={id} className="num">{rm.leadTimeDays ?? ''}</td>;
      case 'shelfLife':
        return <td key={id} className="num">{rm.shelfLifeMonths ?? ''}</td>;
      case 'price':
        return <td key={id} className="num">{rm.lastPurchasePriceNet ?? ''}</td>;
      case 'currency':
        return <td key={id}>{rm.currency ?? ''}</td>;
      case 'factory':
        return (
          <td key={id}>
            {rm.factorySupplied ? <span className="tag warn">factory</span> : ''}
          </td>
        );
      case 'notes':
        return <td key={id} className="col-wrap">{rm.notes ?? ''}</td>;
      default:
        return null;
    }
  };

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
        <HeaderNav />
        <h1>{t.rawMaterials}</h1>
        <span className="page-header-count">{items.length}</span>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-actions">
            <ExportImportButtons
              format="csv"
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
              {filtered.map((rm) => (
                <tr key={rm.id}>
                  {orderedVisibleIds.map((id) => cellFor(id, rm))}
                  <td className="actions actions-sticky">
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
            <ModalHeader
              icon={editing.id ? <IconEdit size={18} /> : <IconPlus size={18} />}
              tone={editing.id ? 'edit' : 'add'}
              title={
                editing.id
                  ? `${t.edit}: ${editing.name ?? ''}`
                  : `${t.add} — ${t.rawMaterials.toLowerCase()}`
              }
              onClose={() => setEditing(null)}
            />
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
              <SearchableSelect
                options={UNITS.map((u) => ({ value: u, label: u }))}
                value={editing.unit ?? 'kg'}
                onChange={(val) => setEditing({ ...editing, unit: val as Unit })}
              />
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
              <NumberInput
                className="input"
                value={editing.moq}
                onChange={(v) => setEditing({ ...editing, moq: v })}
              />
            </div>
            <div className="form-row">
              <label>{t.leadTime}</label>
              <NumberInput
                className="input"
                value={editing.leadTimeDays}
                onChange={(v) => setEditing({ ...editing, leadTimeDays: v })}
              />
            </div>
            <div className="form-row">
              <label>{t.shelfLife}</label>
              <NumberInput
                className="input"
                value={editing.shelfLifeMonths}
                onChange={(v) => setEditing({ ...editing, shelfLifeMonths: v })}
              />
            </div>
            <div className="form-row">
              <label>{t.price}</label>
              <NumberInput
                className="input"
                step="0.01"
                value={editing.lastPurchasePriceNet}
                onChange={(v) => setEditing({ ...editing, lastPurchasePriceNet: v })}
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
