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
  RawStockMatch,
  Supplier,
  Unit,
} from '../../shared/types';
import { totalStockQty, hasExpiredBatch, batchExpiryStatus, isExpired } from '../../shared/expiry';
import ConfirmDialog from '../components/ConfirmDialog';
import BlockedByDialog from '../components/BlockedByDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SkeletonRows from '../components/SkeletonRows';
import { useMinimumLoading } from '../utils/useMinimumLoading';
import SupplierMultiPicker from '../components/SupplierMultiPicker';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';
import StockCell from '../components/StockCell';
import PriceCell from '../components/PriceCell';
import { PriceHistoryList } from '../components/PriceHistory';
import OverageCell from '../components/OverageCell';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import { useColumnResize } from '../utils/useColumnResize';
import { sortRows, type SortValue } from '../utils/sortRows';
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconStar,
  IconImport,
  IconInfo,
  IconClose,
  IconSettings,
  IconDuplicate,
} from '../components/Icons';
import Toggle from '../components/Toggle';
import IconButton from '../components/IconButton';
import HoverTooltip from '../components/HoverTooltip';
import ModalHeader from '../components/ModalHeader';
import ExportImportButtons from '../components/ExportImportButtons';
import SegmentedControl from '../components/SegmentedControl';
import { useEscapeKey } from '../utils/useEscapeKey';
import {
  exportRawMaterialsCsv,
  importRawMaterialsCsv,
  saveFile,
  openFile,
  formatStats,
  ImportSaveError,
} from '../utils/exportImport';

const UNITS: Unit[] = ['kg', 'g', 'l', 'ml'];

// Stock set by hand that the warehouse file would change.
const isManualConflict = (m: RawStockMatch): boolean => !!m.manualConflict;

// Matches the commit needs an explicit take/reject decision for — the main
// process rejects any of them that arrives without one.
const needsRawStockDecision = (m: RawStockMatch): boolean =>
  m.sumMismatch || isManualConflict(m);

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

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
  const [initialLoading, setInitialLoading] = useState(true);
  const showSkeleton = useMinimumLoading(initialLoading);
  const [error, setError] = useState<string | null>(null);
  // A failed first load — shown in the table instead of "no data".
  const [loadError, setLoadError] = useState<string | null>(null);
  // Save error of the edit modal, shown inside it (the page banner sits under
  // the modal overlay).
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
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
      { id: 'price', label: t.price, defaultVisible: true },
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
    widths,
    setWidth,
    resetWidth,
    sort,
    toggleSort,
    orderedColumns,
    orderedVisibleIds,
  } = useColumnPrefs('rawMaterials', COLUMNS);
  const { decorateHeader } = useColumnResize(setWidth, { sort, toggleSort });

  const headerFor = (id: string): React.ReactNode => {
    switch (id) {
      case 'name':
        return (
          <th key={id} className="col-w-lg">
            {t.name}
          </th>
        );
      case 'symbol':
        return (
          <th key={id} className="col-w-md">
            {t.symbol}
          </th>
        );
      case 'unit':
        return (
          <th key={id} className="col-w-sm">
            {t.unit}
          </th>
        );
      case 'stock':
        return (
          <th key={id} className="num col-w-md">
            {t.stock}
          </th>
        );
      case 'suppliers':
        return (
          <th key={id} className="col-w-xl">
            {t.suppliers}
          </th>
        );
      case 'moq':
        return (
          <th key={id} className="num col-w-sm">
            {t.moq}
          </th>
        );
      case 'leadTime':
        return (
          <th key={id} className="num col-w-sm">
            {t.leadTime}
          </th>
        );
      case 'shelfLife':
        return (
          <th key={id} className="num col-w-sm">
            {t.shelfLife}
          </th>
        );
      case 'price':
        return (
          <th key={id} className="num col-w-sm">
            {t.price}
          </th>
        );
      case 'overage':
        return (
          <th key={id} className="num col-w-sm">
            {t.overage}
          </th>
        );
      case 'currency':
        return (
          <th key={id} className="col-w-sm">
            {t.currency}
          </th>
        );
      case 'factory':
        return (
          <th key={id} className="col-w-sm">
            {t.factorySupplied}
          </th>
        );
      case 'notes':
        return (
          <th key={id} className="col-w-lg">
            {t.notes}
          </th>
        );
      default:
        return null;
    }
  };

  const cellFor = (id: string, rm: RawMaterial): React.ReactNode => {
    switch (id) {
      case 'name':
        return (
          <td key={id} className="col-name col-wrap">
            {rm.name}
          </td>
        );
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
        return (
          <td key={id} className="col-wrap">
            {renderSupplierChips(rm)}
          </td>
        );
      case 'moq':
        return (
          <td key={id} className="num">
            {rm.moq ?? ''}
          </td>
        );
      case 'leadTime':
        return (
          <td key={id} className="num">
            {rm.leadTimeDays ?? ''}
          </td>
        );
      case 'shelfLife':
        return (
          <td key={id} className="num">
            {rm.shelfLifeMonths ?? ''}
          </td>
        );
      case 'price':
        return (
          <PriceCell
            key={id}
            price={rm.lastPurchasePriceNet}
            currency={rm.currency}
            history={rm.priceHistory}
            onCommit={(v) => onSetPrice(rm.id, v)}
          />
        );
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
            {rm.factorySupplied ? (
              <span className="tag success">{t.yes}</span>
            ) : (
              <span className="tag danger">{t.no}</span>
            )}
          </td>
        );
      case 'notes':
        return (
          <td key={id} className="col-wrap">
            {rm.notes ?? ''}
          </td>
        );
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

  // Swap one saved item into the list — inline edits return the updated
  // entity, so there is no need to re-fetch the whole catalog.
  const patchItem = (updated: RawMaterial) =>
    setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));

  const onChangeDefaultOverage = async (v: number | undefined) => {
    const next = v ?? 0;
    const previous = defaultOveragePct;
    setDefaultOveragePct(next);
    setError(null);
    try {
      const updated: AppSettings = await window.electronAPI.updateSettings({
        defaultOveragePctRaw: next,
      });
      setDefaultOveragePct(updated.defaultOveragePctRaw);
    } catch (err) {
      setDefaultOveragePct(previous);
      setError(errorMessage(err));
    }
  };

  // Per-item overage edit from the grid. `undefined` clears it → inherit default.
  const onSetOverage = async (id: string, pct: number | undefined) => {
    setError(null);
    try {
      patchItem(await window.electronAPI.updateRawMaterial(id, { overagePct: pct }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // Inline price edit from the grid. The catalog update records the change in
  // the item's price history (see recordPriceChange in main/database.ts).
  const onSetPrice = async (id: string, price: number | undefined) => {
    setError(null);
    try {
      patchItem(
        await window.electronAPI.updateRawMaterial(id, { lastPurchasePriceNet: price }),
      );
    } catch (err) {
      setError(errorMessage(err));
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
      // First load shows skeleton rows in the table (see SkeletonRows), not a
      // blocking overlay.
      setInitialLoading(true);
      setLoadError(null);
      try {
        await reload();
      } catch (err) {
        setLoadError(`${t.loadFailed}: ${errorMessage(err)}`);
      } finally {
        setInitialLoading(false);
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

  // Header-click sort key per column: what the cell shows, numeric where the
  // column is. Stock is compared in g/ml so 2 kg ranks above 500 g.
  const sortValueFor = (id: string, rm: RawMaterial): SortValue => {
    switch (id) {
      case 'name':
        return rm.name;
      case 'symbol':
        return rm.mpFirmaSymbol;
      case 'unit':
        return rm.unit;
      case 'stock':
        return totalStockQty(rm) * (rm.unit === 'kg' || rm.unit === 'l' ? 1000 : 1);
      case 'suppliers': {
        // The first chip shown: the preferred supplier, else the first one.
        const ids = rm.supplierIds ?? [];
        const first =
          rm.preferredSupplierId && ids.includes(rm.preferredSupplierId)
            ? rm.preferredSupplierId
            : ids[0];
        return first ? suppliers.find((s) => s.id === first)?.name : undefined;
      }
      case 'moq':
        return rm.moq;
      case 'leadTime':
        return rm.leadTimeDays;
      case 'shelfLife':
        return rm.shelfLifeMonths;
      case 'price':
        return rm.lastPurchasePriceNet;
      case 'overage':
        return rm.overagePct ?? defaultOveragePct;
      case 'currency':
        return rm.currency;
      case 'factory':
        return !!rm.factorySupplied;
      case 'notes':
        return rm.notes;
      default:
        return undefined;
    }
  };
  const sorted = useMemo(
    () => sortRows(filtered, sort, sortValueFor),
    [filtered, sort, suppliers, defaultOveragePct],
  );

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
    setEditError(null);
    setEditing({
      name: '',
      unit: 'kg',
      supplierIds: [],
      factorySupplied: false,
    });
  };

  const startEdit = (rm: RawMaterial) => {
    setStockDirty(false);
    setEditError(null);
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
  const updateBatch = (
    idx: number,
    patch: Partial<NonNullable<RawMaterial['stockBatches']>[number]>,
  ) => {
    setStockDirty(true);
    setEditing((e) =>
      e
        ? {
            ...e,
            stockBatches: (e.stockBatches ?? []).map((b, i) =>
              i === idx ? { ...b, ...patch } : b,
            ),
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
    if (!editing || !editing.name?.trim() || saving) return;
    setEditError(null);
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
      // With batches the stock is their sum; without, it's the flat value
      // typed in the "Stan" field.
      payload.stockQty =
        batches.length > 0
          ? batches.reduce((s, b) => s + (b.qty ?? 0), 0)
          : editing.stockQty ?? 0;
      payload.stockSource = 'manual';
      // The old import file no longer describes this stock.
      payload.stockSourceFile = undefined;
      payload.stockUpdatedAt = new Date().toISOString();
    }
    setSaving(true);
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
      setEditError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const onSetStock = async (id: string, qty: number) => {
    setError(null);
    try {
      // Same path as the component list: flags the stock 'manual', clears the
      // import file label and stamps the date in the main process. A flat
      // value replaces the batch breakdown (updateRawMaterial drops batches
      // when stockQty comes without them), so total and calculators agree.
      const updated = await window.electronAPI.setManualStock('raw', id, qty);
      patchItem(updated as RawMaterial);
    } catch (err) {
      setError(errorMessage(err));
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
        if (err instanceof ImportSaveError) {
          setError(`${t.importSaveFailed}: ${err.message}`);
          // Part of the file may already be saved — show what landed.
          await reload().catch(() => undefined);
        } else {
          setError(`${t.importInvalidFile}: ${errorMessage(err)}`);
        }
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
    // A decision is needed for Σ(C)≠D mismatches, for hand-set stock the file
    // would change, or for unmatched (create/ignore) rows; otherwise import all
    // matched materials straight away.
    // Parse warnings (unreadable dates, …) also open the modal so they are
    // seen before anything is written.
    if (
      analysis.matches.some(needsRawStockDecision) ||
      analysis.unmatched.length > 0 ||
      (analysis.warnings ?? []).length > 0
    ) {
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
      .filter(needsRawStockDecision)
      .map((m) => ({ itemId: m.itemId, action: actions.get(m.itemId) ?? 'reject' }));
    await commitRawStock(analysis, decisions, createNames);
  };

  const onDelete = async (rm: RawMaterial) => {
    setConfirmDelete(null);
    setError(null);
    try {
      const result = await window.electronAPI.deleteRawMaterial(rm.id);
      if (!result.ok) {
        setBlockedBy(result.blockedBy ?? []);
      } else {
        setItems((prev) => prev.filter((x) => x.id !== rm.id));
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onDuplicate = async (rm: RawMaterial) => {
    if (duplicatingId) return;
    setDuplicatingId(rm.id);
    setError(null);
    try {
      await window.electronAPI.duplicateRawMaterial(rm.id);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDuplicatingId(null);
    }
  };

  const onDeleteAll = async () => {
    setConfirmDeleteAll(false);
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.deleteAllInProgress);
    const total = items.length;
    try {
      // One call; items still used by a product are skipped and reported.
      const res = await window.electronAPI.deleteCatalogItems(
        'raw',
        items.map((rm) => rm.id),
      );
      const deleted = res.deleted;
      const blocked = res.blocked.length;
      const blockers = res.blocked.flatMap((b) => b.blockedBy);
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
    } catch (err) {
      setError(errorMessage(err));
      await reload().catch(() => undefined);
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
          const chip = (
            <span key={id} className={`supplier-chip ${isPreferred ? 'preferred' : ''}`}>
              {isPreferred && (
                <span className="supplier-chip-star">
                  <IconStar size={11} />
                </span>
              )}
              {supplierName(id)}
            </span>
          );
          return isPreferred ? (
            <HoverTooltip key={id} className="hover-tooltip-compact" trigger={chip}>
              {t.preferredSupplier}
            </HoverTooltip>
          ) : (
            chip
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
        <div style={{ marginLeft: 'auto' }}>
          <IconButton
            className="btn-sm"
            icon={<IconSettings size={14} />}
            label={t.settings}
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </div>

      <div className="card card-fill">
        <div className="toolbar">
          <div className="toolbar-actions">
            <ExportImportButtons format="csv" onExport={onExport} onImport={onImport} busy={busy} />
            <HoverTooltip
              triggerClassName="icon-button-trigger"
              trigger={
                <button className="btn btn-import" onClick={onClickImportXlsx} disabled={busy}>
                  <IconImport size={13} /> {t.rawMaterialsImportXlsx}
                </button>
              }
            >
              {t.rawMaterialsImportXlsxHint}
            </HoverTooltip>
            <HoverTooltip
              triggerClassName="icon-button-trigger"
              trigger={
                <button className="btn btn-import" onClick={onClickImportMagazyn} disabled={busy}>
                  <IconImport size={13} /> {t.magazynStockImport}
                </button>
              }
            >
              {t.rawStockImportHint}
            </HoverTooltip>
            <ColumnPicker
              columns={orderedColumns}
              isVisible={isVisible}
              toggle={toggle}
              reorder={reorder}
              reset={resetColumns}
              widths={widths}
              resetWidth={resetWidth}
            />
            <button
              className="btn danger"
              onClick={() => setConfirmDeleteAll(true)}
              disabled={busy || items.length === 0}
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
        {error && (
          <div className="error-text" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}
        {info && (
          <div className="hint" style={{ marginBottom: 8 }}>
            {info}
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {orderedVisibleIds.map((id) => decorateHeader(headerFor(id), id, widths[id]))}
                <th className="col-filler" aria-hidden />
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody
              key={showSkeleton ? 'loading' : 'ready'}
              className={showSkeleton ? undefined : 'rows-enter'}
            >
              {showSkeleton ? (
                <SkeletonRows cells={orderedVisibleIds.length} filler actions />
              ) : (
                sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={orderedVisibleIds.length + 2}
                      className={loadError ? 'error-text' : 'hint'}
                    >
                      {loadError ?? (query ? '—' : t.noData)}
                    </td>
                  </tr>
                )
              )}
              {!showSkeleton && sorted.map((rm) => (
                <tr key={rm.id}>
                  {orderedVisibleIds.map((id) => cellFor(id, rm))}
                  <td className="col-filler" />
                  <td className="actions actions-sticky">
                    <div className="btn-row">
                      <IconButton
                        className="btn-sm soft-danger"
                        icon={<IconTrash size={14} />}
                        label={t.delete}
                        onClick={() => setConfirmDelete(rm)}
                      />
                      <IconButton
                        className="btn-sm soft-edit"
                        icon={<IconEdit size={14} />}
                        label={t.edit}
                        onClick={() => startEdit(rm)}
                      />
                      <IconButton
                        className="btn-sm soft-success"
                        icon={<IconDuplicate size={14} />}
                        label={t.duplicate}
                        disabled={duplicatingId !== null}
                        onClick={() => void onDuplicate(rm)}
                      />
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
                <div>
                  <Toggle
                    checked={!!editing.factorySupplied}
                    onChange={(v) => setEditing({ ...editing, factorySupplied: v })}
                    ariaLabel={t.factorySupplied}
                  />
                </div>
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
              <div className="form-row" style={{ alignItems: 'flex-start' }}>
                <label>{t.priceHistory}</label>
                <div style={{ flex: 1 }}>
                  <PriceHistoryList
                    history={editing.priceHistory}
                    fallbackCurrency={editing.currency}
                  />
                </div>
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
              {/* Stock is editable inline on the list, so it is here too: a
                  flat value while there are no batches (with batches the
                  stock is their sum, edited per batch below). */}
              {(editing.stockBatches ?? []).length === 0 && (
                <div className="form-row">
                  <label>
                    {t.stock} ({editing.unit ?? 'kg'})
                  </label>
                  <NumberInput
                    className="input"
                    step="0.001"
                    value={editing.stockQty}
                    onChange={(v) => {
                      setEditing({ ...editing, stockQty: v });
                      setStockDirty(true);
                    }}
                  />
                </div>
              )}
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
                                    updateBatch(idx, {
                                      retestExpiryDate: e.target.value || undefined,
                                    })
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
                                <IconButton
                                  className="btn-sm soft-danger"
                                  icon={<IconClose size={12} />}
                                  label={t.delete}
                                  onClick={() => removeBatch(idx)}
                                />
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
              {editError && <div className="error-text">{editError}</div>}
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditing(null)}>
                {t.cancel}
              </button>
              <button
                className="btn primary-filled"
                onClick={() => void onSave()}
                disabled={saving || !editing.name?.trim()}
              >
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
        <XlsxImportSummaryModal summary={xlsxSummary} onClose={() => setXlsxSummary(null)} />
      )}

      {rawStockAnalysis && (
        <RawStockDiffModal
          analysis={rawStockAnalysis}
          onCancel={() => setRawStockAnalysis(null)}
          onApply={onApplyRawStock}
        />
      )}

      {blockedBy && <BlockedByDialog blockedBy={blockedBy} onClose={() => setBlockedBy(null)} />}

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
          <label className="form-row" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
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
          <label className="form-row" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
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
              {t.rawMaterialsImportSuppliersCreated}: <strong>{summary.suppliersCreated}</strong>
            </li>
            <li>
              {t.rawMaterialsImportSuppliersUpdated}: <strong>{summary.suppliersUpdated}</strong>
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
const BatchTooltip: React.FC<{
  batches: RawStockAnalysis['unmatched'][number]['batches'];
  unit: string;
}> = ({ batches, unit }) => {
  const t = useT();
  return (
    <HoverTooltip
      align="left"
      triggerClassName="stock-note-icon"
      trigger={<IconInfo size={12} />}
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
    () => analysis.matches.filter(needsRawStockDecision),
    [analysis],
  );
  const hasSumMismatch = mismatches.some((m) => m.sumMismatch);
  const hasManualConflict = mismatches.some(isManualConflict);
  const unmatched = analysis.unmatched;
  // A plain Σ mismatch defaults to taking the import — the file is the fresh
  // source of truth. Stock someone set by hand defaults to keeping it (the
  // same default the main process applies), so a correction is never lost by
  // just clicking through.
  const [actions, setActions] = useState<Map<string, 'take' | 'reject'>>(
    () =>
      new Map(
        mismatches.map((m) => [m.itemId, isManualConflict(m) ? 'reject' : 'take'] as const),
      ),
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
      <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconImport size={18} />}
          tone="add"
          title={
            hasSumMismatch && !hasManualConflict ? t.rawStockDiffTitle : t.rawStockDecisionTitle
          }
          onClose={onCancel}
        />
        <div className="modal-body">
          {(analysis.warnings ?? []).length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div className="warn-text" style={{ fontWeight: 600, marginBottom: 4 }}>
                {t.rawStockParseWarnings} ({(analysis.warnings ?? []).length})
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                {(analysis.warnings ?? []).map((w, i) => (
                  <li key={i} className="hint">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mismatches.length > 0 && (
            <>
              {hasSumMismatch && (
                <div className="hint" style={{ marginBottom: 12 }}>
                  {t.rawStockDiffIntro}
                </div>
              )}
              {hasManualConflict && (
                <div className="warn-text" style={{ marginBottom: 12, fontSize: 12 }}>
                  {t.rawStockManualConflictIntro}
                </div>
              )}
              {unmatched.length > 0 && (
                <div className="warn-text" style={{ marginBottom: 12, fontSize: 12 }}>
                  {t.magazynStockUnmatchedNotice.replace('{n}', String(unmatched.length))}
                </div>
              )}
              <div className="apply-all-row">
                <span className="apply-all-label">{t.applyToAllLabel}</span>
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
                      <th>{t.rawStockReasonCol}</th>
                      <th className="num">{t.magazynStockColCurrent}</th>
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
                          <td>
                            {isManualConflict(m) && (
                              <span className="tag warn">{t.rawStockReasonManual}</span>
                            )}{' '}
                            {m.sumMismatch && (
                              <span className="tag">{t.rawStockReasonSumMismatch}</span>
                            )}
                          </td>
                          <td className="num">
                            {fmt(m.currentQty)} {m.unit}
                          </td>
                          <td className="num">
                            {fmt(m.batchSum)} {m.unit}
                          </td>
                          <td className="num">
                            {fmt(m.reportedTotal)} {m.unit}
                          </td>
                          <td>
                            <SegmentedControl
                              size="sm"
                              ariaLabel={m.name}
                              value={action}
                              onChange={(v) => setOne(m.itemId, v)}
                              options={[
                                { value: 'reject', label: t.rawStockReject, tone: 'danger' },
                                { value: 'take', label: t.rawStockTake, tone: 'success' },
                              ]}
                            />
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
              <div className="apply-all-row">
                <span className="apply-all-label">{t.applyToAllLabel}</span>
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
                            <SegmentedControl
                              size="sm"
                              ariaLabel={u.name}
                              value={create ? 'create' : 'ignore'}
                              onChange={(v) => {
                                if ((v === 'create') !== create) toggleCreate(u.name);
                              }}
                              options={[
                                { value: 'ignore', label: t.magazynStockIgnore, tone: 'neutral' },
                                { value: 'create', label: t.magazynStockCreate, tone: 'success' },
                              ]}
                            />
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
