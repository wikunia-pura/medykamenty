import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  RawMaterial,
  RawMaterialsImportMode,
  RawMaterialsImportSummary,
  Supplier,
  Unit,
} from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import BlockedByDialog from '../components/BlockedByDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SupplierMultiPicker from '../components/SupplierMultiPicker';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconStar,
  IconImport,
  IconClose,
} from '../components/Icons';
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
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [xlsxSummary, setXlsxSummary] = useState<RawMaterialsImportSummary | null>(null);
  // XLSX import: when not null, the mode-selection modal is open with this
  // mode pre-selected. The actual file pick happens in the main process after
  // the user confirms the mode.
  const [xlsxImportMode, setXlsxImportMode] = useState<RawMaterialsImportMode | null>(null);
  const [blockedBy, setBlockedBy] = useState<string[] | null>(null);

  useEscapeKey(() => setEditing(null), !!editing);
  useEscapeKey(() => setXlsxSummary(null), !!xlsxSummary);

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
            {rm.factorySupplied
              ? <span className="tag success">{t.yes}</span>
              : <span className="tag danger">{t.no}</span>}
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
    void (async () => {
      setLoaderMessage(t.loading);
      try {
        await reload();
      } finally {
        setLoaderMessage(null);
      }
    })();
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
    setLoaderMessage(t.loaderExporting);
    try {
      const { content, filename } = exportRawMaterialsCsv(items, suppliers);
      await saveFile(filename, content, 'csv');
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onImport = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
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
      setLoaderMessage(null);
    }
  };

  const runImportXlsx = async (mode: RawMaterialsImportMode) => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
    try {
      const res = await window.electronAPI.importRawMaterialsXlsx(mode);
      // User canceling the OS file picker returns ok:false with no error.
      if (res.ok && res.summary) {
        setXlsxSummary(res.summary);
        setXlsxImportMode(null);
        await reload();
      } else {
        setXlsxImportMode(null);
        if (res.error) setError(`${t.rawMaterialsImportFailed}: ${res.error}`);
      }
    } catch (err) {
      setError(`${t.rawMaterialsImportFailed}: ${(err as Error).message}`);
      setXlsxImportMode(null);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onConfirmImportXlsx = async () => {
    if (!xlsxImportMode) return;
    await runImportXlsx(xlsxImportMode);
  };

  // When the list is empty, merge and overwrite are equivalent — skip the
  // dialog and import straight away.
  const onClickImportXlsx = () => {
    if (items.length === 0) {
      void runImportXlsx('merge');
    } else {
      setXlsxImportMode('merge');
    }
  };

  const onDelete = async (rm: RawMaterial) => {
    setConfirmDelete(null);
    const result = await window.electronAPI.deleteRawMaterial(rm.id);
    if (!result.ok) {
      setBlockedBy(result.blockedBy ?? []);
    } else {
      await reload();
    }
  };

  const onDeleteAll = async () => {
    setConfirmDeleteAll(false);
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.deleteAllInProgress);
    const total = items.length;
    let deleted = 0;
    let blocked = 0;
    const blockers: string[] = [];
    try {
      for (const rm of items) {
        const result = await window.electronAPI.deleteRawMaterial(rm.id);
        if (result.ok) deleted++;
        else {
          blocked++;
          if (result.blockedBy) blockers.push(...result.blockedBy);
        }
      }
      if (blocked === 0) {
        setInfo(t.deleteAllSuccess.replace('{n}', String(deleted)));
      } else {
        setInfo(
          t.deleteAllPartial
            .replace('{n}', String(deleted))
            .replace('{total}', String(total))
            .replace('{blocked}', String(blocked)),
        );
        setBlockedBy(Array.from(new Set(blockers)));
      }
      await reload();
    } finally {
      setBusy(false);
      setLoaderMessage(null);
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
            <button
              className="btn btn-import"
              onClick={onClickImportXlsx}
              disabled={busy}
              title={t.rawMaterialsImportXlsxHint}
            >
              <IconImport size={13} /> {t.rawMaterialsImportXlsx}
            </button>
            <ColumnPicker
              columns={orderedColumns}
              isVisible={isVisible}
              toggle={toggle}
              reorder={reorder}
              reset={resetColumns}
            />
            <button
              className="btn danger"
              onClick={() => setConfirmDeleteAll(true)}
              disabled={busy || items.length === 0}
              title={t.deleteAll}
            >
              <IconTrash size={13} /> {t.deleteAll}
            </button>
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

      {confirmDeleteAll && (
        <ConfirmDialog
          message={t.deleteAllConfirm.replace('{n}', String(items.length))}
          onConfirm={onDeleteAll}
          onCancel={() => setConfirmDeleteAll(false)}
          danger
        />
      )}

      {xlsxImportMode !== null && (
        <RawMaterialsImportModeDialog
          mode={xlsxImportMode}
          onChange={setXlsxImportMode}
          onCancel={() => setXlsxImportMode(null)}
          onConfirm={onConfirmImportXlsx}
          busy={busy}
        />
      )}

      {xlsxSummary && (
        <XlsxImportSummaryModal
          summary={xlsxSummary}
          onClose={() => setXlsxSummary(null)}
        />
      )}

      {blockedBy && (
        <BlockedByDialog blockedBy={blockedBy} onClose={() => setBlockedBy(null)} />
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

// ---------- Mode picker ----------

interface ModeDialogProps {
  mode: RawMaterialsImportMode;
  onChange: (m: RawMaterialsImportMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}

const RawMaterialsImportModeDialog: React.FC<ModeDialogProps> = ({
  mode,
  onChange,
  onCancel,
  onConfirm,
  busy,
}) => {
  const t = useT();
  useEscapeKey(onCancel, !busy);
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconImport size={18} />}
          tone="add"
          title={t.rawMaterialsImportDialogTitle}
          onClose={onCancel}
        />
        <div className="modal-body">
          <label
            className="form-row"
            style={{ alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="raw-import-mode"
              checked={mode === 'merge'}
              onChange={() => onChange('merge')}
              disabled={busy}
              style={{ marginTop: 4 }}
            />
            <div style={{ marginLeft: 8 }}>
              <strong>{t.rawMaterialsImportModeMerge}</strong>
              <div className="hint" style={{ marginTop: 4 }}>
                {t.rawMaterialsImportModeMergeDesc}
              </div>
            </div>
          </label>
          <label
            className="form-row"
            style={{ alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="raw-import-mode"
              checked={mode === 'overwrite'}
              onChange={() => onChange('overwrite')}
              disabled={busy}
              style={{ marginTop: 4 }}
            />
            <div style={{ marginLeft: 8 }}>
              <strong>{t.rawMaterialsImportModeOverwrite}</strong>
              <div className="hint" style={{ marginTop: 4 }}>
                {t.rawMaterialsImportModeOverwriteDesc}
              </div>
            </div>
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel} disabled={busy}>
            {t.cancel}
          </button>
          <button
            className={`btn ${mode === 'overwrite' ? 'danger' : 'primary-filled'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {t.rawMaterialsImportConfirm}
          </button>
        </div>
      </div>
    </div>
  );
};

interface XlsxSummaryModalProps {
  summary: RawMaterialsImportSummary;
  onClose: () => void;
}

const XlsxImportSummaryModal: React.FC<XlsxSummaryModalProps> = ({ summary, onClose }) => {
  const t = useT();
  useEscapeKey(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconImport size={18} />}
          tone="add"
          title={t.rawMaterialsImportSummary}
          onClose={onClose}
        />
        <div className="modal-body">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              {t.rawMaterialsImportRawCreated}: <strong>{summary.rawCreated}</strong>
            </li>
            <li>
              {t.rawMaterialsImportRawUpdated}: <strong>{summary.rawUpdated}</strong>
            </li>
            {summary.rawSkipped > 0 && (
              <li>
                {t.rawMaterialsImportRawSkipped}: <strong>{summary.rawSkipped}</strong>
              </li>
            )}
            {summary.rawDeleted > 0 && (
              <li>
                {t.rawMaterialsImportRawDeleted}: <strong>{summary.rawDeleted}</strong>
              </li>
            )}
            <li>
              {t.rawMaterialsImportSuppliersCreated}:{' '}
              <strong>{summary.suppliersCreated}</strong>
            </li>
            <li>
              {t.rawMaterialsImportSuppliersUpdated}:{' '}
              <strong>{summary.suppliersUpdated}</strong>
            </li>
          </ul>
          {summary.warnings.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 6 }}>
                <strong>{t.rawMaterialsImportWarnings}</strong> ({summary.warnings.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                {summary.warnings.slice(0, 20).map((w, i) => (
                  <li key={i} className="hint">
                    {w}
                  </li>
                ))}
                {summary.warnings.length > 20 && (
                  <li className="hint">… +{summary.warnings.length - 20}</li>
                )}
              </ul>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn primary-filled" onClick={onClose}>
            <IconClose size={13} /> {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RawMaterials;
