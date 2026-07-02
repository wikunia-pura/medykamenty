import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  AppSettings,
  RawMaterial,
  RawMaterialsImportMode,
  RawMaterialsImportSummary,
  RawStockAnalysis,
  RawStockDecision,
  Supplier,
  Unit,
} from '../../shared/types';
import {
  totalStockQty,
  hasExpiredBatch,
  batchExpiryStatus,
  isExpired,
} from '../../shared/expiry';
import ConfirmDialog from '../components/ConfirmDialog';
import BlockedByDialog from '../components/BlockedByDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SupplierMultiPicker from '../components/SupplierMultiPicker';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';
import StockCell from '../components/StockCell';
import OverageCell from '../components/OverageCell';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconStar,
  IconImport,
  IconClose,
  IconSettings,
  IconDuplicate,
} from '../components/Icons';
import HoverTooltip from '../components/HoverTooltip';
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

// Stable id for a new stock batch. crypto.randomUUID needs a secure context,
// which the production file:// renderer isn't — fall back to a random string.
const newBatchId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `b-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const RawMaterials: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<RawMaterial[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Type-level default overage % for raw materials; items without their own
  // overagePct inherit this. Edited in the settings modal.
  const [defaultOveragePct, setDefaultOveragePct] = useState<number>(0);
  // Draft value for the "set for all" bulk action (settings modal).
  const [overageForAll, setOverageForAll] = useState<number | undefined>(undefined);
  const [confirmOverageForAll, setConfirmOverageForAll] = useState<number | null>(null);
  const [confirmResetOverageAll, setConfirmResetOverageAll] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  // Warehouse ("Magazyn") raw-stock import: analysis awaiting the user's
  // take/reject decision on Σ(C)≠D mismatches. Consistent materials import
  // without opening the modal.
  const [rawStockAnalysis, setRawStockAnalysis] = useState<RawStockAnalysis | null>(null);
  // Expiry filters. 'expiring' uses `expiringDays` as the window (user-picked).
  const [expiryFilter, setExpiryFilter] = useState<'all' | 'expired' | 'expiring'>('all');
  const [expiringDays, setExpiringDays] = useState<number>(30);
  // True once the user has touched the stock/batch editor in the modal — only
  // then does save write stock fields (and flag the item as manually set), so
  // editing other fields never disturbs import-sourced stock.
  const [stockDirty, setStockDirty] = useState(false);

  useEscapeKey(() => setEditing(null), !!editing);
  useEscapeKey(() => setXlsxSummary(null), !!xlsxSummary);
  useEscapeKey(() => setRawStockAnalysis(null), !!rawStockAnalysis);
  useEscapeKey(() => setSettingsOpen(false), settingsOpen);

  const COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.name, required: true },
      { id: 'symbol', label: t.symbol, defaultVisible: true },
      { id: 'unit', label: t.unit, defaultVisible: true },
      { id: 'stock', label: t.stock, defaultVisible: true },
      { id: 'suppliers', label: t.suppliers, defaultVisible: true },
      { id: 'moq', label: t.moq, defaultVisible: true },
      { id: 'leadTime', label: t.leadTime, defaultVisible: true },
      { id: 'shelfLife', label: t.shelfLife, defaultVisible: false },
      { id: 'price', label: t.price, defaultVisible: false },
      { id: 'overage', label: t.overage, defaultVisible: true },
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
      case 'stock':
        return <th key={id} className="num col-w-md">{t.stock}</th>;
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
      case 'overage':
        return <th key={id} className="num col-w-sm">{t.overage}</th>;
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
      case 'stock':
        return (
          <StockCell
            key={id}
            qty={totalStockQty(rm)}
            unit={rm.unit}
            source={rm.stockSource}
            updatedAt={rm.stockUpdatedAt}
            sourceFile={rm.stockSourceFile}
            batches={rm.stockBatches}
            onCommit={(q) => onSetStock(rm.id, q)}
          />
        );
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
      case 'overage':
        return (
          <OverageCell
            key={id}
            pct={rm.overagePct}
            defaultPct={defaultOveragePct}
            onCommit={(pct) => onSetOverage(rm.id, pct)}
          />
        );
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
    const [rms, ss, s] = await Promise.all([
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listSuppliers(),
      window.electronAPI.getSettings(),
    ]);
    setItems(rms);
    setSuppliers(ss);
    setDefaultOveragePct(s.defaultOveragePctRaw);
  };

  const onChangeDefaultOverage = async (v: number | undefined) => {
    const next = v ?? 0;
    setDefaultOveragePct(next);
    const updated: AppSettings = await window.electronAPI.updateSettings({
      defaultOveragePctRaw: next,
    });
    setDefaultOveragePct(updated.defaultOveragePctRaw);
  };

  // Per-item overage edit from the grid. `undefined` clears it → inherit default.
  const onSetOverage = async (id: string, pct: number | undefined) => {
    setError(null);
    try {
      await window.electronAPI.updateRawMaterial(id, { overagePct: pct });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSetOverageForAll = async (pct: number) => {
    setConfirmOverageForAll(null);
    setError(null);
    setInfo(null);
    try {
      const n = await window.electronAPI.setOveragePctForAll('raw', pct);
      setInfo(t.overageSetForAllDone.replace('{n}', String(n)));
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Clear the explicit overage on every raw material → all inherit the default.
  const onResetOverageForAll = async () => {
    setConfirmResetOverageAll(false);
    setError(null);
    setInfo(null);
    try {
      const n = await window.electronAPI.setOveragePctForAll('raw', null);
      setInfo(t.overageResetAllDone.replace('{n}', String(n)));
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
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
    const q = query.trim();
    return items.filter((rm) => {
      if (q) {
        // Include resolved supplier names in the search corpus.
        const supplierNames = (rm.supplierIds ?? [])
          .map((id) => suppliers.find((s) => s.id === id)?.name ?? '')
          .join(' ');
        if (!matchesQuery({ ...rm, supplierNames }, query)) return false;
      }
      if (expiryFilter === 'expired') {
        if (!hasExpiredBatch(rm)) return false;
      } else if (expiryFilter === 'expiring') {
        // Any batch expiring within the chosen window (not yet expired).
        const soon = (rm.stockBatches ?? []).some(
          (b) => batchExpiryStatus(b, expiringDays) === 'expiring',
        );
        if (!soon) return false;
      }
      return true;
    });
  }, [items, suppliers, query, expiryFilter, expiringDays]);

  // Counts for the filter chips (independent of the active expiry filter).
  const expiredCount = useMemo(() => items.filter((rm) => hasExpiredBatch(rm)).length, [items]);
  const expiringCount = useMemo(
    () =>
      items.filter((rm) =>
        (rm.stockBatches ?? []).some((b) => batchExpiryStatus(b, expiringDays) === 'expiring'),
      ).length,
    [items, expiringDays],
  );

  const onAdd = () => {
    setStockDirty(false);
    setEditing({
      name: '',
      unit: 'kg',
      supplierIds: [],
      factorySupplied: false,
    });
  };

  const startEdit = (rm: RawMaterial) => {
    setStockDirty(false);
    setEditing(rm);
  };

  // ---- stock/batch editor (modal) ----
  const addBatch = () => {
    setStockDirty(true);
    setEditing((e) =>
      e
        ? {
            ...e,
            stockBatches: [...(e.stockBatches ?? []), { id: newBatchId(), qty: 0 }],
          }
        : e,
    );
  };
  const updateBatch = (idx: number, patch: Partial<NonNullable<RawMaterial['stockBatches']>[number]>) => {
    setStockDirty(true);
    setEditing((e) =>
      e
        ? {
            ...e,
            stockBatches: (e.stockBatches ?? []).map((b, i) => (i === idx ? { ...b, ...patch } : b)),
          }
        : e,
    );
  };
  const removeBatch = (idx: number) => {
    setStockDirty(true);
    setEditing((e) =>
      e ? { ...e, stockBatches: (e.stockBatches ?? []).filter((_, i) => i !== idx) } : e,
    );
  };

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const payload: Partial<RawMaterial> = {
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
      overagePct: editing.overagePct,
    };
    // Only write stock when the user actually edited it here, so tweaking other
    // fields never overwrites import-sourced stock. Editing it manually flags
    // the item as 'manual' and stamps the date.
    if (stockDirty) {
      const batches = (editing.stockBatches ?? []).filter(
        (b) => (b.qty ?? 0) !== 0 || b.expiryDate || b.retestExpiryDate,
      );
      payload.stockBatches = batches;
      payload.stockQty = batches.reduce((s, b) => s + (b.qty ?? 0), 0);
      payload.stockSource = 'manual';
      payload.stockUpdatedAt = new Date().toISOString();
    }
    try {
      if (editing.id) {
        await window.electronAPI.updateRawMaterial(editing.id, payload);
      } else {
        await window.electronAPI.createRawMaterial(
          payload as Omit<RawMaterial, 'id' | 'createdAt' | 'updatedAt'>,
        );
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSetStock = async (id: string, qty: number) => {
    setError(null);
    try {
      // A manual edit overrides the batch breakdown: drop the batches and keep
      // a single flat value so the displayed total and the calculators agree.
      await window.electronAPI.updateRawMaterial(id, {
        stockQty: qty,
        stockSource: 'manual',
        stockUpdatedAt: new Date().toISOString(),
        stockBatches: [],
      });
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

  const commitRawStock = async (
    analysis: RawStockAnalysis,
    decisions: RawStockDecision[],
    createNames: Set<string>,
  ) => {
    const createItems = analysis.unmatched.filter((u) => createNames.has(u.name));
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
    try {
      const res = await window.electronAPI.commitRawStock({
        sourceFile: analysis.sourceFile,
        analysis,
        decisions,
        createItems,
      });
      let msg = t.rawStockImportSummary
        .replace('{imported}', String(res.imported))
        .replace('{rejected}', String(res.rejected));
      if (res.created > 0) {
        msg += ' ' + t.magazynStockSummaryCreated.replace('{n}', String(res.created));
      }
      const ignored =
        analysis.unmatched.length - createItems.length + analysis.ambiguousNames.length;
      if (ignored > 0) {
        msg += ' ' + t.magazynStockSummaryIgnored.replace('{n}', String(ignored));
      }
      setInfo(msg);
      await reload();
    } catch (err) {
      setError(`${t.rawStockImportFailed}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onClickImportMagazyn = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
    let analysis: RawStockAnalysis | null = null;
    try {
      const res = await window.electronAPI.analyzeRawStock();
      if (!res.ok) {
        if (res.error) setError(`${t.rawStockImportFailed}: ${res.error}`);
        return;
      }
      analysis = res.analysis ?? null;
    } catch (err) {
      setError(`${t.rawStockImportFailed}: ${(err as Error).message}`);
      return;
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
    if (!analysis || (analysis.matches.length === 0 && analysis.unmatched.length === 0)) {
      setInfo(t.magazynStockNoMatches);
      return;
    }
    // A decision is needed for Σ(C)≠D mismatches or unmatched (create/ignore)
    // rows; otherwise import all matched materials straight away.
    if (analysis.matches.some((m) => m.sumMismatch) || analysis.unmatched.length > 0) {
      setRawStockAnalysis(analysis);
    } else {
      await commitRawStock(analysis, [], new Set());
    }
  };

  const onApplyRawStock = async (
    actions: Map<string, 'take' | 'reject'>,
    createNames: Set<string>,
  ) => {
    const analysis = rawStockAnalysis;
    if (!analysis) return;
    setRawStockAnalysis(null);
    const decisions: RawStockDecision[] = analysis.matches
      .filter((m) => m.sumMismatch)
      .map((m) => ({ itemId: m.itemId, action: actions.get(m.itemId) ?? 'reject' }));
    await commitRawStock(analysis, decisions, createNames);
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
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => setSettingsOpen(true)}
          title={t.settings}
          aria-label={t.settings}
        >
          <IconSettings size={14} />
        </button>
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
            <button
              className="btn btn-import"
              onClick={onClickImportMagazyn}
              disabled={busy}
              title={t.rawStockImportHint}
            >
              <IconImport size={13} /> {t.magazynStockImport}
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
        <div className="expiry-filter-bar">
          <button
            type="button"
            className={`chip ${expiryFilter === 'all' ? 'active' : ''}`}
            onClick={() => setExpiryFilter('all')}
          >
            {t.expiryFilterAll}
          </button>
          <button
            type="button"
            className={`chip ${expiryFilter === 'expired' ? 'active' : ''} ${expiredCount > 0 ? 'chip-danger' : ''}`}
            onClick={() => setExpiryFilter('expired')}
          >
            {t.expiryFilterExpired} ({expiredCount})
          </button>
          <button
            type="button"
            className={`chip ${expiryFilter === 'expiring' ? 'active' : ''}`}
            onClick={() => setExpiryFilter('expiring')}
          >
            {t.expiryFilterExpiring} ({expiringCount})
          </button>
          <div className="expiry-filter-days">
            <span className="hint">{t.expiryFilterWithinDays}</span>
            <NumberInput
              className="input"
              style={{ width: 80 }}
              value={expiringDays}
              emptyValue={0}
              onChange={(v) => {
                setExpiringDays(v ?? 0);
                if ((v ?? 0) > 0) setExpiryFilter('expiring');
              }}
            />
            <span className="hint">{t.days}</span>
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
                        onClick={() => startEdit(rm)}
                        title={t.edit}
                      >
                        <IconEdit size={13} /> {t.edit}
                      </button>
                      <button
                        className="btn btn-sm soft-success"
                        onClick={async () => {
                          await window.electronAPI.duplicateRawMaterial(rm.id);
                          await reload();
                        }}
                        title={t.duplicate}
                      >
                        <IconDuplicate size={13} /> {t.duplicate}
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
                suppliers={suppliers.filter((s) => s.type !== 'component')}
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
              <label>{t.overage} (%)</label>
              <NumberInput
                className="input"
                step="0.1"
                value={editing.overagePct}
                placeholder={String(defaultOveragePct)}
                onChange={(v) => setEditing({ ...editing, overagePct: v })}
              />
            </div>
            <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>
              {t.overageInheritHint.replace('{n}', String(defaultOveragePct))}
            </div>
            <div className="form-row">
              <label>{t.notes}</label>
              <textarea
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              />
            </div>
            <div className="form-row" style={{ alignItems: 'flex-start' }}>
              <label>{t.stockBatches}</label>
              <div style={{ flex: 1 }}>
                {(editing.stockBatches ?? []).length > 0 && (
                  <table className="table batch-table">
                    <thead>
                      <tr>
                        <th className="num">{t.stock}</th>
                        <th>{t.expiry}</th>
                        <th>{t.expiryRetest}</th>
                        <th>{t.notes}</th>
                        <th className="actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {(editing.stockBatches ?? []).map((b, idx) => {
                        const expired = isExpired(b);
                        return (
                          <tr key={b.id} className={expired ? 'stock-batch-expired' : undefined}>
                            <td className="num">
                              <NumberInput
                                className="input"
                                style={{ width: 90 }}
                                value={b.qty}
                                emptyValue={0}
                                step="0.001"
                                onChange={(v) => updateBatch(idx, { qty: v ?? 0 })}
                              />
                            </td>
                            <td>
                              <input
                                type="date"
                                className="input"
                                value={b.expiryDate ?? ''}
                                onChange={(e) =>
                                  updateBatch(idx, { expiryDate: e.target.value || undefined })
                                }
                              />
                              {expired && <span className="stock-batch-flag">{t.expired}</span>}
                            </td>
                            <td>
                              <input
                                type="date"
                                className="input"
                                value={b.retestExpiryDate ?? ''}
                                onChange={(e) =>
                                  updateBatch(idx, { retestExpiryDate: e.target.value || undefined })
                                }
                              />
                            </td>
                            <td>
                              <input
                                className="input"
                                value={b.note ?? ''}
                                onChange={(e) =>
                                  updateBatch(idx, { note: e.target.value || undefined })
                                }
                              />
                            </td>
                            <td className="actions">
                              <button
                                type="button"
                                className="btn btn-sm soft-danger btn-icon-only"
                                onClick={() => removeBatch(idx)}
                                title={t.delete}
                              >
                                <IconClose size={12} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center' }}>
                  <button type="button" className="btn btn-sm soft-edit" onClick={addBatch}>
                    <IconPlus size={13} /> {t.stockBatchAdd}
                  </button>
                  {(editing.stockBatches ?? []).length > 0 && (
                    <span className="hint">
                      {t.stock}:{' '}
                      {(editing.stockBatches ?? [])
                        .reduce((s, b) => s + (b.qty ?? 0), 0)
                        .toLocaleString()}{' '}
                      {editing.unit}
                    </span>
                  )}
                </div>
                <div className="hint" style={{ marginTop: 4 }}>
                  {t.stockBatchesEditHint}
                </div>
              </div>
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

      {confirmOverageForAll !== null && (
        <ConfirmDialog
          message={t.overageSetForAllConfirm
            .replace('{pct}', String(confirmOverageForAll))
            .replace('{n}', String(items.length))}
          onConfirm={() => onSetOverageForAll(confirmOverageForAll)}
          onCancel={() => setConfirmOverageForAll(null)}
        />
      )}

      {confirmResetOverageAll && (
        <ConfirmDialog
          message={t.overageResetAllConfirm.replace('{n}', String(items.length))}
          onConfirm={onResetOverageForAll}
          onCancel={() => setConfirmResetOverageAll(false)}
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

      {rawStockAnalysis && (
        <RawStockDiffModal
          analysis={rawStockAnalysis}
          onCancel={() => setRawStockAnalysis(null)}
          onApply={onApplyRawStock}
        />
      )}

      {blockedBy && (
        <BlockedByDialog blockedBy={blockedBy} onClose={() => setBlockedBy(null)} />
      )}

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <ModalHeader
              icon={<IconSettings size={18} />}
              tone="edit"
              title={t.settings}
              onClose={() => setSettingsOpen(false)}
            />
            <div className="modal-body">
              <div className="form-row">
                <label>{t.overageDefaultRaw}</label>
                <NumberInput
                  className="input"
                  step="0.1"
                  value={defaultOveragePct}
                  emptyValue={0}
                  onChange={onChangeDefaultOverage}
                />
              </div>
              <div className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
                {t.overageInheritHint.replace('{n}', String(defaultOveragePct))}
              </div>
              <div className="form-row">
                <label>{t.overageSetForAll}</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <NumberInput
                    className="input"
                    step="0.1"
                    value={overageForAll}
                    placeholder={String(defaultOveragePct)}
                    onChange={setOverageForAll}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={overageForAll === undefined}
                    onClick={() =>
                      overageForAll !== undefined && setConfirmOverageForAll(overageForAll)
                    }
                  >
                    {t.overageSetForAll}
                  </button>
                </div>
              </div>
              <div className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
                {t.overageSetForAllHint}
              </div>
              <div className="form-row">
                <label>{t.overageResetAll}</label>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmResetOverageAll(true)}
                >
                  {t.overageResetAll}
                </button>
              </div>
              <div className="hint" style={{ marginTop: -4 }}>
                {t.overageResetAllHint}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn primary-filled" onClick={() => setSettingsOpen(false)}>
                {t.close}
              </button>
            </div>
          </div>
        </div>
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

// ---------- Warehouse raw-stock import: Σ(C)≠D decisions ----------
//
// Lists only the materials whose file batch quantities (Σ column C) don't add
// up to the file's own total (column D). The user resolves each — take the
// import (write the batches) or reject (leave the catalog material untouched) —
// individually or via the bulk buttons. Consistent materials import silently.

interface RawStockDiffModalProps {
  analysis: RawStockAnalysis;
  onCancel: () => void;
  onApply: (actions: Map<string, 'take' | 'reject'>, createNames: Set<string>) => void;
}

// Hover tooltip listing a material's file batches (qty + effective expiry).
const BatchTooltip: React.FC<{ batches: RawStockAnalysis['unmatched'][number]['batches']; unit: string }> = ({
  batches,
  unit,
}) => {
  const t = useT();
  return (
    <HoverTooltip
      align="left"
      triggerClassName="stock-note-icon"
      trigger={<IconImport size={12} />}
    >
      <div className="shortage-tooltip-header">{t.stockBatches}</div>
      <ul className="stock-batch-list">
        {batches.map((b, i) => (
          <li key={i}>
            <span className="stock-batch-qty">
              {b.qty.toLocaleString()} {unit}
            </span>
            <span className="stock-batch-exp">
              {b.retestExpiryDate || b.expiryDate
                ? `${t.expiry}: ${new Date((b.retestExpiryDate ?? b.expiryDate) as string).toLocaleDateString()}`
                : t.noExpiry}
            </span>
          </li>
        ))}
      </ul>
    </HoverTooltip>
  );
};

const RawStockDiffModal: React.FC<RawStockDiffModalProps> = ({ analysis, onCancel, onApply }) => {
  const t = useT();
  useEscapeKey(onCancel);
  const mismatches = useMemo(
    () => analysis.matches.filter((m) => m.sumMismatch),
    [analysis],
  );
  const unmatched = analysis.unmatched;
  // Default to taking the import — the file is the fresh source of truth.
  const [actions, setActions] = useState<Map<string, 'take' | 'reject'>>(
    () => new Map(mismatches.map((m) => [m.itemId, 'take' as const])),
  );
  // Unmatched materials default to ignore; the user opts them in to create.
  const [createSet, setCreateSet] = useState<Set<string>>(new Set());

  const setAll = (a: 'take' | 'reject') =>
    setActions(new Map(mismatches.map((m) => [m.itemId, a])));
  const setOne = (id: string, a: 'take' | 'reject') =>
    setActions((prev) => new Map(prev).set(id, a));
  const setCreateAll = (create: boolean) =>
    setCreateSet(create ? new Set(unmatched.map((u) => u.name)) : new Set());
  const toggleCreate = (name: string) =>
    setCreateSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const fmt = (n?: number) => (n === undefined ? '—' : n.toLocaleString());

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconImport size={18} />}
          tone="add"
          title={t.rawStockDiffTitle}
          onClose={onCancel}
        />
        <div className="modal-body">
          {mismatches.length > 0 && (
            <>
              <div className="hint" style={{ marginBottom: 12 }}>
                {t.rawStockDiffIntro}
              </div>
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <button type="button" className="btn btn-sm" onClick={() => setAll('reject')}>
                  {t.rawStockRejectAll}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setAll('take')}>
                  {t.rawStockTakeAll}
                </button>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.name}</th>
                      <th className="num">{t.rawStockBatchSum}</th>
                      <th className="num">{t.rawStockReportedTotal}</th>
                      <th>{t.magazynStockColDecision}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatches.map((m) => {
                      const action = actions.get(m.itemId) ?? 'take';
                      return (
                        <tr key={m.itemId}>
                          <td className="col-wrap">
                            {m.name}
                            <BatchTooltip batches={m.batches} unit={m.unit} />
                          </td>
                          <td className="num">
                            {fmt(m.batchSum)} {m.unit}
                          </td>
                          <td className="num">
                            {fmt(m.reportedTotal)} {m.unit}
                          </td>
                          <td>
                            <div className="btn-row">
                              <button
                                type="button"
                                className={`btn btn-sm ${action === 'reject' ? 'primary-filled' : ''}`}
                                onClick={() => setOne(m.itemId, 'reject')}
                              >
                                {t.rawStockReject}
                              </button>
                              <button
                                type="button"
                                className={`btn btn-sm ${action === 'take' ? 'primary-filled' : ''}`}
                                onClick={() => setOne(m.itemId, 'take')}
                              >
                                {t.rawStockTake}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {unmatched.length > 0 && (
            <>
              <div
                className="hint"
                style={{ marginBottom: 12, marginTop: mismatches.length > 0 ? 20 : 0 }}
              >
                {t.magazynStockUnmatchedIntro.replace('{n}', String(unmatched.length))}
              </div>
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <button type="button" className="btn btn-sm" onClick={() => setCreateAll(false)}>
                  {t.magazynStockIgnoreAll}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setCreateAll(true)}>
                  {t.magazynStockCreateAll}
                </button>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.name}</th>
                      <th className="num">{t.rawStockBatchSum}</th>
                      <th>{t.magazynStockColDecision}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatched.map((u) => {
                      const create = createSet.has(u.name);
                      return (
                        <tr key={u.name}>
                          <td className="col-wrap">
                            {u.name}
                            <BatchTooltip batches={u.batches} unit={u.unit} />
                          </td>
                          <td className="num">
                            {fmt(u.batchSum)} {u.unit}
                          </td>
                          <td>
                            <div className="btn-row">
                              <button
                                type="button"
                                className={`btn btn-sm ${!create ? 'primary-filled' : ''}`}
                                onClick={() => create && toggleCreate(u.name)}
                              >
                                {t.magazynStockIgnore}
                              </button>
                              <button
                                type="button"
                                className={`btn btn-sm ${create ? 'primary-filled' : ''}`}
                                onClick={() => !create && toggleCreate(u.name)}
                              >
                                {t.magazynStockCreate}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className="btn primary-filled" onClick={() => onApply(actions, createSet)}>
            {t.magazynStockApply}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RawMaterials;
