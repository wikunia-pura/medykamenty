import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  StockRow,
  ImportSummary,
  RawMaterial,
  PackagingComponent,
  AppSettings,
  StockConflict,
  StockConflictResolution,
} from '../../shared/types';
import type { ViewKey } from './types';
import DropZone from '../components/DropZone';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import { useColumnResize } from '../utils/useColumnResize';
import { sortRows, type SortValue } from '../utils/sortRows';
import {
  IconTrash,
  IconPlus,
  IconCheck,
  IconEdit,
  IconImport,
  IconChevronDown,
  IconChevronRight,
} from '../components/Icons';
import IconButton from '../components/IconButton';
import ModalHeader from '../components/ModalHeader';
import { useEscapeKey } from '../utils/useEscapeKey';
import UnmatchedRowModal, { type ResolveAction } from '../components/UnmatchedRowModal';
import BulkUnmatchedModal from '../components/BulkUnmatchedModal';
import SegmentedControl from '../components/SegmentedControl';
import HoverTooltip from '../components/HoverTooltip';

interface Props {
  onNavigate?: (key: ViewKey) => void;
  taskBanner?: React.ReactNode;
}

type StagedFile = { name: string; path: string; kind: 'raw' | 'component' };
type SnapshotInfo = { id: string; importedAt: string; sourceFile: string } | null;

function detectKind(name: string): 'raw' | 'component' {
  const lower = name.toLowerCase();
  if (lower.includes('komponen')) return 'component';
  return 'raw';
}

const RAW_EXPANDED_KEY = 'stockImport.rawExpanded';
const COMP_EXPANDED_KEY = 'stockImport.compExpanded';

function readExpanded(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

const StockImport: React.FC<Props> = ({ onNavigate, taskBanner }) => {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [conflicts, setConflicts] = useState<StockConflict[]>([]);
  const [rawRows, setRawRows] = useState<StockRow[]>([]);
  const [compRows, setCompRows] = useState<StockRow[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [rawExpanded, setRawExpanded] = useState<boolean>(() => readExpanded(RAW_EXPANDED_KEY));
  const [compExpanded, setCompExpanded] = useState<boolean>(() => readExpanded(COMP_EXPANDED_KEY));
  const [rawSnapshot, setRawSnapshot] = useState<SnapshotInfo>(null);
  const [compSnapshot, setCompSnapshot] = useState<SnapshotInfo>(null);
  const [adoptBusy, setAdoptBusy] = useState(false);
  const [bsxSettings, setBsxSettings] = useState<AppSettings['bsx']>(undefined);
  const [xlsxOpen, setXlsxOpen] = useState(false);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [compQuery, setCompQuery] = useState('');
  const [rawUnmatchedOnly, setRawUnmatchedOnly] = useState(false);
  const [compUnmatchedOnly, setCompUnmatchedOnly] = useState(false);
  const [editingRow, setEditingRow] = useState<{
    row: StockRow;
    kind: 'raw' | 'component';
    snapshotId: string;
  } | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<{
    row: StockRow;
    snapshotId: string;
  } | null>(null);
  const [confirmDeleteSnapshot, setConfirmDeleteSnapshot] = useState<'raw' | 'component' | null>(
    null,
  );
  // Queue of unmatched rows for the resolve-row modal. Single-row clicks push a
  // 1-element queue. The modal shows the head of the queue and advances on
  // each resolve/skip.
  const [resolveQueue, setResolveQueue] = useState<{ row: StockRow; kind: 'raw' | 'component' }[]>(
    [],
  );
  // Open state for the bulk list modal: shows every unmatched row at once and
  // lets the user pick a target/action per row before pressing "Apply all".
  const [bulkResolve, setBulkResolve] = useState<{
    rows: StockRow[];
    kind: 'raw' | 'component';
    // Rows whose decision failed on the last "apply" — shown inside the modal.
    errors?: { rowKey: string; name: string; message: string }[];
  } | null>(null);

  const STOCK_COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.name, required: true },
      { id: 'match', label: t.stockMatchColumn, required: true },
      { id: 'qty', label: t.quantity, defaultVisible: true },
      { id: 'netUnit', label: t.stockNetUnit, defaultVisible: true },
      { id: 'vatUnit', label: t.stockVatUnit, defaultVisible: true },
      { id: 'grossUnit', label: t.stockGrossUnit, defaultVisible: true },
      { id: 'currency', label: t.currency, defaultVisible: true },
      { id: 'netTotal', label: t.stockNetTotal, defaultVisible: true },
      { id: 'vatTotal', label: t.stockVatTotal, defaultVisible: true },
      { id: 'grossTotal', label: t.stockGrossTotal, defaultVisible: true },
      { id: 'symbol', label: t.symbol, defaultVisible: true },
      { id: 'manufacturer', label: t.stockManufacturer, defaultVisible: true },
      { id: 'warehouse', label: t.stockWarehouse, defaultVisible: false },
      { id: 'notes', label: t.notes, defaultVisible: false },
    ],
    [t],
  );
  const stockColumns = useColumnPrefs('stockImport', STOCK_COLUMNS);
  const { decorateHeader } = useColumnResize(stockColumns.setWidth, {
    sort: stockColumns.sort,
    toggleSort: stockColumns.toggleSort,
  });

  // Never throws: a failed load keeps what is on screen and shows the error,
  // rather than leaving empty tables that read as "no stock".
  const loadCurrent = async (): Promise<boolean> => {
    try {
      const [stock, rms, cs, settings] = await Promise.all([
        window.electronAPI.getCurrentStock(),
        window.electronAPI.listRawMaterials(),
        window.electronAPI.listComponents(),
        window.electronAPI.getSettings(),
      ]);
      setRawRows(stock.raw);
      setCompRows(stock.components);
      setRawMaterials(rms);
      setComponents(cs);
      setRawSnapshot(stock.rawSnapshot);
      setCompSnapshot(stock.componentSnapshot);
      setBsxSettings(settings.bsx);
      return true;
    } catch (err) {
      setError(t.loadDataFailed.replace('{error}', (err as Error).message));
      return false;
    }
  };

  // Local edits of the current snapshot rows, instead of re-fetching stock,
  // catalog and settings after a single-row change.
  const patchRows = (kind: 'raw' | 'component', fn: (rows: StockRow[]) => StockRow[]) => {
    if (kind === 'raw') setRawRows(fn);
    else setCompRows(fn);
  };

  // Creates a brand-new catalog entry from the row and links the snapshot to it.
  const adoptRowAsNew = async (row: StockRow, kind: 'raw' | 'component') => {
    const snapshotId = kind === 'raw' ? rawSnapshot?.id : compSnapshot?.id;
    if (!snapshotId) return;
    if (kind === 'raw') {
      const created = await window.electronAPI.createRawMaterial({
        name: row.name,
        mpFirmaSymbol: row.mpFirmaSymbol,
        unit: 'kg',
        supplierIds: [],
        factorySupplied: false,
        lastPurchasePriceNet: row.netPrice,
        currency: row.currency,
      });
      await window.electronAPI.resolveStockMatch(snapshotId, row.rowKey, 'raw', created.id);
    } else {
      const created = await window.electronAPI.createComponent({
        name: row.name,
        type: 'other',
        mpFirmaSymbol: row.mpFirmaSymbol,
        supplierIds: [],
        lastPurchasePriceNet: row.netPrice,
        currency: row.currency,
      });
      await window.electronAPI.resolveStockMatch(snapshotId, row.rowKey, 'component', created.id);
    }
  };

  const openResolveModalFor = (row: StockRow, kind: 'raw' | 'component') => {
    setError(null);
    setResolveQueue([{ row, kind }]);
  };

  const adoptAllUnmatched = (kind: 'raw' | 'component') => {
    const rows = kind === 'raw' ? rawRows : compRows;
    const unmatched = rows.filter(
      (r) => !r.matchAmbiguous && !r.matchedRawMaterialId && !r.matchedComponentId,
    );
    if (unmatched.length === 0) return;
    setError(null);
    setBulkResolve({ rows: unmatched, kind });
  };

  const advanceQueue = () => {
    setResolveQueue((prev) => prev.slice(1));
  };

  // Applies a single resolution decision against its snapshot. Reused by both
  // the single-row modal and the bulk-apply loop.
  const applyDecision = async (row: StockRow, kind: 'raw' | 'component', action: ResolveAction) => {
    const snapshotId = kind === 'raw' ? rawSnapshot?.id : compSnapshot?.id;
    if (!snapshotId) throw new Error(t.stockNoSnapshot);
    if (action.type === 'add-new') {
      await adoptRowAsNew(row, kind);
      return;
    }
    if (action.type === 'save-alias') {
      if (kind === 'raw') {
        await window.electronAPI.addRawMaterialAlias(action.targetId, row.name);
      } else {
        await window.electronAPI.addComponentAlias(action.targetId, row.name);
      }
    } else if (action.type === 'rename-existing') {
      // Rename catalog entry to the import name, and keep the previous catalog
      // name as an alias so future imports of the old name still match.
      if (kind === 'raw') {
        const existing = await window.electronAPI.getRawMaterial(action.targetId);
        if (existing) {
          const oldName = existing.name;
          await window.electronAPI.updateRawMaterial(action.targetId, { name: row.name });
          if (oldName && oldName !== row.name) {
            try {
              await window.electronAPI.addRawMaterialAlias(action.targetId, oldName);
            } catch {
              /* alias may already exist */
            }
          }
        }
      } else {
        const existing = await window.electronAPI.getComponent(action.targetId);
        if (existing) {
          const oldName = existing.name;
          await window.electronAPI.updateComponent(action.targetId, { name: row.name });
          if (oldName && oldName !== row.name) {
            try {
              await window.electronAPI.addComponentAlias(action.targetId, oldName);
            } catch {
              /* alias may already exist */
            }
          }
        }
      }
    }
    await window.electronAPI.resolveStockMatch(snapshotId, row.rowKey, kind, action.targetId);
  };

  const [resolveError, setResolveError] = useState<string | null>(null);
  const handleResolve = async (action: ResolveAction) => {
    if (resolveQueue.length === 0) return;
    const head = resolveQueue[0];
    setAdoptBusy(true);
    setResolveError(null);
    try {
      await applyDecision(head.row, head.kind, action);
      advanceQueue();
      await loadCurrent();
    } catch (err) {
      // Shown inside the resolve modal — the page banner sits behind it.
      setResolveError((err as Error).message);
    } finally {
      setAdoptBusy(false);
    }
  };

  // Applies every decision, carrying on past individual failures. Applied rows
  // leave the modal at once — pressing "Apply" again must never re-apply them
  // (an "add new" would create a duplicate catalog item). Failed rows stay,
  // with their errors shown inside the modal.
  const handleBulkApply = async (decisions: { row: StockRow; action: ResolveAction }[]) => {
    if (!bulkResolve) return;
    const kind = bulkResolve.kind;
    setError(null);
    setAdoptBusy(true);
    setLoaderMessage(t.loaderProcessing);
    const applied = new Set<string>();
    const errors: { rowKey: string; name: string; message: string }[] = [];
    try {
      for (const d of decisions) {
        try {
          await applyDecision(d.row, kind, d.action);
          applied.add(d.row.rowKey);
        } catch (err) {
          errors.push({ rowKey: d.row.rowKey, name: d.row.name, message: (err as Error).message });
        }
      }
    } finally {
      setBulkResolve((prev) => {
        if (!prev) return prev;
        if (errors.length === 0) return null;
        return {
          ...prev,
          rows: prev.rows.filter((r) => !applied.has(r.rowKey)),
          errors,
        };
      });
      await loadCurrent();
      setAdoptBusy(false);
      setLoaderMessage(null);
    }
  };

  const handleCancelQueue = () => {
    setResolveQueue([]);
  };

  const onDeleteRow = async () => {
    if (!confirmDeleteRow) return;
    const { row, snapshotId } = confirmDeleteRow;
    setConfirmDeleteRow(null);
    setError(null);
    try {
      await window.electronAPI.deleteStockRow(snapshotId, row.rowKey);
      const kind = snapshotId === rawSnapshot?.id ? 'raw' : 'component';
      patchRows(kind, (rows) => rows.filter((r) => r.rowKey !== row.rowKey));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDeleteSnapshot = async () => {
    if (!confirmDeleteSnapshot) return;
    const kind = confirmDeleteSnapshot;
    setConfirmDeleteSnapshot(null);
    setError(null);
    try {
      // Delete every snapshot of this kind (not just the latest) — there can be
      // older retained snapshots that would otherwise resurface as "current".
      await window.electronAPI.deleteStockSnapshotsByKind(kind);
      if (kind === 'raw') {
        setRawRows([]);
        setRawSnapshot(null);
      } else {
        setCompRows([]);
        setCompSnapshot(null);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSaveEditing = async () => {
    if (!editingRow) return;
    const { row, snapshotId, kind } = editingRow;
    setError(null);
    try {
      const saved = await window.electronAPI.updateStockRow(snapshotId, row.rowKey, row);
      if (!saved) {
        // The snapshot or the row is gone (deleted meanwhile) — nothing was
        // written; don't pretend it was.
        setError(t.actionFailed.replace('{error}', t.stockNoSnapshot));
        setEditingRow(null);
        await loadCurrent();
        return;
      }
      patchRows(kind, (rows) => rows.map((r) => (r.rowKey === row.rowKey ? saved : r)));
      setEditingRow(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void (async () => {
      // No blocking overlay on entry — the banners are usable right away and
      // the snapshot tables appear when loaded.
      await loadCurrent();
    })();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(RAW_EXPANDED_KEY, rawExpanded ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [rawExpanded]);

  useEffect(() => {
    try {
      localStorage.setItem(COMP_EXPANDED_KEY, compExpanded ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [compExpanded]);

  const onFilesSelected = (files: { name: string; path: string }[]) => {
    setError(null);
    setSummary(null);
    setStaged((prev) => {
      const byPath = new Map(prev.map((f) => [f.path, f]));
      for (const f of files) {
        byPath.set(f.path, { ...f, kind: detectKind(f.name) });
      }
      return Array.from(byPath.values());
    });
  };

  const removeStaged = (path: string) => setStaged((prev) => prev.filter((f) => f.path !== path));

  const setStagedKind = (path: string, kind: 'raw' | 'component') =>
    setStaged((prev) => prev.map((f) => (f.path === path ? { ...f, kind } : f)));

  // Set after a fetch / import in this session until the snapshot is saved to
  // the catalog — the banner then says the reports still see the old stock.
  const [syncPending, setSyncPending] = useState(false);

  const startBsxImport = async () => {
    setError(null);
    setSummary(null);
    setBusy(true);
    setLoaderMessage(t.bsxImporting);
    try {
      // Phase A: stock snapshots (fast, ~2-3s). Show table immediately.
      const res = await window.electronAPI.importStockFromBsx();
      setSummary(res);
      setSyncPending(true);
      setRawExpanded(true);
      setCompExpanded(true);
      await loadCurrent();
      setLoaderMessage(null);
      setBusy(false);

      // Phase B: PZ price backfill (slow, ~30-60s). Fire-and-forget so the
      // user can already work with the matched rows. The cards show an
      // inline loader tag until this resolves and we re-fetch the snapshot.
      const snapshotIds: { raw?: string; component?: string } = {};
      if (res.snapshotIds[0]) snapshotIds.raw = res.snapshotIds[0];
      if (res.snapshotIds[1]) snapshotIds.component = res.snapshotIds[1];
      if (snapshotIds.raw || snapshotIds.component) {
        setPricesLoading(true);
        window.electronAPI
          .loadBsxPrices(snapshotIds)
          .then(async (priceRes) => {
            if (!priceRes.ok) {
              setError(`${t.bsxPricesFailed}: ${priceRes.error}`);
            }
            await loadCurrent();
          })
          .catch((err) => {
            setError(`${t.bsxPricesFailed}: ${(err as Error).message}`);
          })
          .finally(() => setPricesLoading(false));
      }
    } catch (err) {
      setError((err as Error).message);
      setLoaderMessage(null);
      setBusy(false);
    }
  };

  const handleResolveConflicts = async (resolutions: StockConflictResolution[]) => {
    setError(null);
    try {
      // Only catalog quantities change — the snapshot rows on screen stay valid.
      await window.electronAPI.resolveStockConflicts(resolutions);
      setConflicts([]);
      setSyncPending(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Explicit, user-triggered sync of catalog stock from the current snapshots.
  // Applies non-conflicting quantities silently and opens the conflict dialog
  // for any manually-edited items that disagree.
  const syncCatalog = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.stockSyncInProgress);
    try {
      // Writes snapshot quantities into the catalog; the snapshot rows shown
      // here are unchanged, so no reload.
      const res = await window.electronAPI.syncStockCatalog();
      if (res.conflicts.length > 0) {
        setConflicts(res.conflicts);
      } else {
        setSyncPending(false);
        setInfo(t.stockSyncDone.replace('{n}', String(res.applied)));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const startImport = async () => {
    if (staged.length === 0) return;
    setError(null);
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
    setSummary(null);
    try {
      const rawFiles = staged.filter((f) => f.kind === 'raw');
      const compFiles = staged.filter((f) => f.kind === 'component');

      const totals: ImportSummary = {
        snapshotIds: [],
        rawCount: 0,
        componentCount: 0,
        matched: 0,
        ambiguous: 0,
        unmatched: 0,
      };

      const accumulate = (s: ImportSummary) => {
        totals.snapshotIds = [...totals.snapshotIds, ...s.snapshotIds];
        totals.rawCount = (totals.rawCount ?? 0) + (s.rawCount ?? 0);
        totals.componentCount = (totals.componentCount ?? 0) + (s.componentCount ?? 0);
        totals.matched += s.matched;
        totals.ambiguous += s.ambiguous;
        totals.unmatched += s.unmatched;
      };

      const maxLen = Math.max(rawFiles.length, compFiles.length);
      for (let i = 0; i < maxLen; i++) {
        const args: { rawPath?: string; componentPath?: string } = {};
        if (rawFiles[i]) args.rawPath = rawFiles[i].path;
        if (compFiles[i]) args.componentPath = compFiles[i].path;
        const res = await window.electronAPI.importStock(args);
        accumulate(res);
      }

      setSummary(totals);
      setSyncPending(true);
      setStaged([]);
      if (rawFiles.length > 0) setRawExpanded(false);
      if (compFiles.length > 0) setCompExpanded(false);
      await loadCurrent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const isUnmatched = (r: StockRow) =>
    !r.matchAmbiguous && !r.matchedRawMaterialId && !r.matchedComponentId;

  const renderRows = (rows: StockRow[], kind: 'raw' | 'component') => {
    const snapshotId = kind === 'raw' ? rawSnapshot?.id : compSnapshot?.id;
    if (!snapshotId) return null;
    const unmatched = rows.filter(isUnmatched).length;
    const query = kind === 'raw' ? rawQuery : compQuery;
    const setQuery = kind === 'raw' ? setRawQuery : setCompQuery;
    const unmatchedOnly = kind === 'raw' ? rawUnmatchedOnly : compUnmatchedOnly;
    const setUnmatchedOnly = kind === 'raw' ? setRawUnmatchedOnly : setCompUnmatchedOnly;

    let filtered = rows;
    if (unmatchedOnly) filtered = filtered.filter(isUnmatched);
    if (query.trim()) filtered = filtered.filter((r) => matchesQuery(r, query));

    // Header-click sort key per column: the row's value; 'match' ranks
    // unmatched → ambiguous → matched. Sorted before the 200-row cap below.
    const sortValueFor = (id: string, r: StockRow): SortValue => {
      switch (id) {
        case 'name':
          return r.name;
        case 'match':
          if (r.matchAmbiguous) return 1;
          return r.matchedRawMaterialId || r.matchedComponentId ? 2 : 0;
        case 'qty':
          return r.qty;
        case 'netUnit':
          return r.netPrice;
        case 'vatUnit':
          return r.vatPrice;
        case 'grossUnit':
          return r.grossPrice;
        case 'currency':
          return r.currency;
        case 'netTotal':
          return r.oNet;
        case 'vatTotal':
          return r.oVat;
        case 'grossTotal':
          return r.oGross;
        case 'symbol':
          return r.mpFirmaSymbol;
        case 'manufacturer':
          return r.manufacturerSymbol;
        case 'warehouse':
          return r.warehouse;
        case 'notes':
          return r.notes;
        default:
          return undefined;
      }
    };
    const sorted = sortRows(filtered, stockColumns.sort, sortValueFor);

    const headerFor = (id: string): React.ReactNode => {
      switch (id) {
        case 'name':
          return (
            <th key={id} className="col-name-wide">
              {t.name}
            </th>
          );
        case 'match':
          return (
            <th key={id} className="col-w-match">
              {t.stockMatchColumn}
            </th>
          );
        case 'qty':
          return (
            <th key={id} className="num col-w-sm">
              {t.quantity}
            </th>
          );
        case 'netUnit':
          return (
            <th key={id} className="num col-w-sm">
              {t.stockNetUnit}
            </th>
          );
        case 'vatUnit':
          return (
            <th key={id} className="num col-w-sm">
              {t.stockVatUnit}
            </th>
          );
        case 'grossUnit':
          return (
            <th key={id} className="num col-w-sm">
              {t.stockGrossUnit}
            </th>
          );
        case 'currency':
          return (
            <th key={id} className="col-w-sm">
              {t.currency}
            </th>
          );
        case 'netTotal':
          return (
            <th key={id} className="num col-w-sm">
              {t.stockNetTotal}
            </th>
          );
        case 'vatTotal':
          return (
            <th key={id} className="num col-w-sm">
              {t.stockVatTotal}
            </th>
          );
        case 'grossTotal':
          return (
            <th key={id} className="num col-w-sm">
              {t.stockGrossTotal}
            </th>
          );
        case 'symbol':
          return (
            <th key={id} className="col-w-md">
              {t.symbol}
            </th>
          );
        case 'manufacturer':
          return (
            <th key={id} className="col-w-md">
              {t.stockManufacturer}
            </th>
          );
        case 'warehouse':
          return (
            <th key={id} className="col-w-md">
              {t.stockWarehouse}
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

    const matchCell = (r: StockRow) => {
      const matchedRow = r.matchedRawMaterialId || r.matchedComponentId;
      if (r.matchAmbiguous) {
        return (
          <HoverTooltip
            className="hover-tooltip-compact"
            trigger={
              <span className="match-badge warn" aria-label={t.rowsAmbiguous}>
                ?
              </span>
            }
          >
            {t.rowsAmbiguous}
          </HoverTooltip>
        );
      }
      if (matchedRow) {
        return (
          <HoverTooltip
            className="hover-tooltip-compact"
            trigger={
              <span className="match-badge success" aria-label={t.rowsMatched}>
                <IconCheck size={12} />
              </span>
            }
          >
            {t.rowsMatched}
          </HoverTooltip>
        );
      }
      return (
        <HoverTooltip
          className="hover-tooltip-compact"
          trigger={
            <button
              className="match-badge danger as-button"
              disabled={adoptBusy}
              onClick={() => openResolveModalFor(r, kind)}
              aria-label={kind === 'raw' ? t.adoptAsRaw : t.adoptAsComponent}
            >
              <IconPlus size={12} />
            </button>
          }
        >
          {kind === 'raw' ? t.adoptAsRaw : t.adoptAsComponent}
        </HoverTooltip>
      );
    };

    // Renders a missing value as a muted dash so the user can tell empty data
    // apart from a legitimate zero. Numeric columns set isPriceCol=true; while
    // BSX prices are loading in the background we hide the dash for those
    // columns so the page doesn't read as "data permanently missing".
    const cell = (
      value: number | string | undefined | null,
      isPriceCol: boolean,
    ): React.ReactNode => {
      if (value === null || value === undefined || value === '') {
        if (isPriceCol && pricesLoading) return <span className="cell-empty-loading">…</span>;
        return <span className="cell-empty">—</span>;
      }
      return value;
    };

    const cellFor = (id: string, r: StockRow): React.ReactNode => {
      switch (id) {
        case 'name':
          return (
            <td key={id} className="col-name col-wrap">
              {r.name}
            </td>
          );
        case 'match':
          return (
            <td key={id} className="col-match">
              {matchCell(r)}
            </td>
          );
        case 'qty':
          return (
            <td key={id} className="num">
              {r.qty}
            </td>
          );
        case 'netUnit':
          return (
            <td key={id} className="num">
              {cell(r.netPrice, true)}
            </td>
          );
        case 'vatUnit':
          return (
            <td key={id} className="num">
              {cell(r.vatPrice, true)}
            </td>
          );
        case 'grossUnit':
          return (
            <td key={id} className="num">
              {cell(r.grossPrice, true)}
            </td>
          );
        case 'currency':
          return <td key={id}>{cell(r.currency, true)}</td>;
        case 'netTotal':
          return (
            <td key={id} className="num">
              {cell(r.oNet, true)}
            </td>
          );
        case 'vatTotal':
          return (
            <td key={id} className="num">
              {cell(r.oVat, true)}
            </td>
          );
        case 'grossTotal':
          return (
            <td key={id} className="num">
              {cell(r.oGross, true)}
            </td>
          );
        case 'symbol':
          return <td key={id}>{cell(r.mpFirmaSymbol, false)}</td>;
        case 'manufacturer':
          return <td key={id}>{cell(r.manufacturerSymbol, false)}</td>;
        case 'warehouse':
          return <td key={id}>{cell(r.warehouse, false)}</td>;
        case 'notes':
          return (
            <td key={id} className="col-wrap">
              {cell(r.notes, true)}
            </td>
          );
        default:
          return null;
      }
    };

    return (
      <>
        {unmatched === 0 && (
          <div style={{ marginBottom: 12 }}>
            <span className="tag success">
              <IconCheck size={11} /> {t.stockAllMatched}
            </span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 280 }}>
            <SearchInput
              value={query}
              onChange={setQuery}
              block
              rightAdornment={
                unmatched > 0 ? (
                  <button
                    type="button"
                    className={`filter-chip ${unmatchedOnly ? 'active' : ''}`}
                    onClick={() => setUnmatchedOnly(!unmatchedOnly)}
                  >
                    {t.stockUnmatchedOnly}
                    <span className="filter-chip-count">{unmatched}</span>
                  </button>
                ) : null
              }
            />
          </div>
          {unmatched > 0 && (
            <button
              className="btn soft-success"
              disabled={adoptBusy}
              onClick={() => adoptAllUnmatched(kind)}
            >
              <IconPlus size={14} />{' '}
              {adoptBusy ? t.loading : t.adoptAllUnmatched.replace('{n}', String(unmatched))}
            </button>
          )}
          <ColumnPicker
            columns={stockColumns.orderedColumns}
            isVisible={stockColumns.isVisible}
            toggle={stockColumns.toggle}
            reorder={stockColumns.reorder}
            reset={stockColumns.reset}
            widths={stockColumns.widths}
            resetWidth={stockColumns.resetWidth}
          />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {stockColumns.orderedVisibleIds.map((id) =>
                  decorateHeader(headerFor(id), id, stockColumns.widths[id]),
                )}
                <th className="col-filler" aria-hidden />
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={stockColumns.orderedVisibleIds.length + 2} className="hint">
                    {query || unmatchedOnly ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {sorted.slice(0, 200).map((r, idx) => (
                <tr key={`${r.rowKey}-${idx}`}>
                  {stockColumns.orderedVisibleIds.map((id) => cellFor(id, r))}
                  <td className="col-filler" />
                  <td className="actions actions-sticky">
                    <div className="btn-row">
                      <IconButton
                        className="btn-sm soft-danger"
                        icon={<IconTrash size={14} />}
                        label={t.delete}
                        onClick={() => setConfirmDeleteRow({ row: r, snapshotId })}
                      />
                      <IconButton
                        className="btn-sm soft-edit"
                        icon={<IconEdit size={14} />}
                        label={t.edit}
                        onClick={() => setEditingRow({ row: r, kind, snapshotId })}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length > 200 && (
                <tr>
                  <td colSpan={stockColumns.orderedVisibleIds.length + 2} className="hint">
                    … +{filtered.length - 200}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderSnapshotCard = (
    kind: 'raw' | 'component',
    rows: StockRow[],
    snapshot: SnapshotInfo,
  ) => {
    if (!snapshot || rows.length === 0) return null;
    const expanded = kind === 'raw' ? rawExpanded : compExpanded;
    const setExpanded = kind === 'raw' ? setRawExpanded : setCompExpanded;
    const title = kind === 'raw' ? t.rawMaterials : t.components;
    const importedAt = new Date(snapshot.importedAt).toLocaleString();
    const unmatched = rows.filter(isUnmatched).length;
    return (
      <div className="card">
        <div
          className={`card-header card-header-toggle${expanded ? '' : ' is-collapsed'}`}
          onClick={() => setExpanded((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setExpanded((v) => !v);
            }
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, userSelect: 'none' }}>
              <span style={{ display: 'inline-block', width: 18 }}>{expanded ? '▾' : '▸'}</span>
              {title} ({rows.length})
            </h2>
            {unmatched > 0 && (
              <span className="tag danger">
                {t.rowsUnmatched}: {unmatched}
              </span>
            )}
            {pricesLoading && snapshot.sourceFile.startsWith('BSX') && (
              <span className="tag pricing-loading">
                <span className="spinner-dot" aria-hidden="true" />
                {t.bsxPricesLoading}
              </span>
            )}
            <span className="hint">
              {t.stockSourceFile}: <code>{snapshot.sourceFile}</code> · {t.stockSnapshotImported}:{' '}
              {importedAt}
            </span>
          </div>
          <button
            className="btn btn-sm danger"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDeleteSnapshot(kind);
            }}
          >
            <IconTrash size={13} /> {t.stockDeleteSnapshot}
          </button>
        </div>
        {expanded && renderRows(rows, kind)}
      </div>
    );
  };

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.stockImport}</h1>
        {(rawRows.length > 0 || compRows.length > 0) && (
          <span className="page-header-count">({rawRows.length + compRows.length})</span>
        )}
      </div>
      {taskBanner}
      {info && (
        <div className="hint" style={{ marginTop: 8 }}>
          {info}
        </div>
      )}
      <p className="subtitle">{t.stockImportSubtitle}</p>

      {(() => {
        const bsxConfigured = Boolean(
          bsxSettings?.cloudKey && bsxSettings?.username && bsxSettings?.hasPassword,
        );
        // Show "Ostatnio pobrano" only when one of the current snapshots was
        // sourced from BSX (sourceFile prefix). Pick the more recent of the two.
        const fromBsx = [rawSnapshot, compSnapshot]
          .filter((s): s is NonNullable<typeof rawSnapshot> => !!s)
          .filter((s) => s.sourceFile.startsWith('BSX'));
        const lastBsxAt = fromBsx
          .map((s) => s.importedAt)
          .sort()
          .pop();
        return (
          <div className="bsx-banner" role="region" aria-label={t.bsxFetchStock}>
            <div className="bsx-banner-icon" aria-hidden="true">
              <IconImport size={32} />
            </div>
            <div className="bsx-banner-body">
              <h2 className="bsx-banner-title">{t.bsxFetchStock}</h2>
              <p className="bsx-banner-subtitle">{t.bsxFetchStockSubtitle}</p>
              {lastBsxAt && (
                <div className="bsx-banner-meta">
                  {t.bsxLastFetched}: {new Date(lastBsxAt).toLocaleString()}
                </div>
              )}
              {!bsxConfigured && <div className="bsx-banner-warning">{t.bsxNotConfigured}</div>}
              {syncPending && <div className="bsx-banner-warning">{t.stockSyncPending}</div>}
            </div>
            {/* Two steps: fetch a snapshot, then (after reviewing the matches)
                write its quantities to the catalog the reports read from.
                Step 2 is placed first on purpose, so the filled step-1 CTA
                sits at the banner's trailing edge. */}
            <div className="bsx-banner-action">
              <button
                type="button"
                className={`btn bsx-banner-secondary${syncPending ? ' pending' : ''}`}
                onClick={() => void syncCatalog()}
                disabled={busy || (!rawSnapshot && !compSnapshot)}
              >
                <IconCheck size={16} /> {t.stockSync}
              </button>
              <button
                className="bsx-banner-cta"
                disabled={busy || !bsxConfigured}
                onClick={startBsxImport}
              >
                <IconImport size={18} />
                {busy ? t.bsxImporting : t.bsxFetchStock}
              </button>
            </div>
          </div>
        );
      })()}

      <div className="xlsx-banner" role="region" aria-label={t.manualXlsxImport}>
        <div className="xlsx-banner-icon" aria-hidden="true">
          <IconImport size={20} />
        </div>
        <div className="xlsx-banner-body">
          <h3 className="xlsx-banner-title">{t.manualXlsxImport}</h3>
          <p className="xlsx-banner-subtitle">{t.manualXlsxImportHint}</p>
        </div>
        <button
          type="button"
          className="xlsx-banner-cta"
          onClick={() => setXlsxOpen((v) => !v)}
          aria-expanded={xlsxOpen}
        >
          {xlsxOpen ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
          {xlsxOpen ? t.hide : t.show}
        </button>
      </div>

      {xlsxOpen && (
        <div className="card secondary-section">
          <div className="card-header">
            <div className="card-title">{t.selectXlsxFiles}</div>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            {t.manualXlsxImportHint}
          </p>

          <DropZone
            title={t.dropZoneTitle}
            subtitle={t.dropZoneSubtitle}
            dragOverLabel={t.dropZoneDragOver}
            accept=".xlsx"
            multiple
            disabled={busy}
            selectedFiles={staged}
            removeFileLabel={t.removeFile}
            onFilesSelected={onFilesSelected}
            onRemoveFile={removeStaged}
          />

          {staged.length > 0 && (
            <>
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th className="col-w-xl">{t.name}</th>
                      <th className="col-w-md">{t.itemKind}</th>
                      <th className="actions">{t.actionsHeader}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staged.map((f) => (
                      <tr key={f.path}>
                        <td className="col-name col-wrap">{f.name}</td>
                        <td>
                          <SearchableSelect
                            options={[
                              { value: 'raw', label: t.rawMaterials },
                              { value: 'component', label: t.components },
                            ]}
                            value={f.kind}
                            onChange={(val) => setStagedKind(f.path, val as 'raw' | 'component')}
                          />
                        </td>
                        <td className="actions">
                          <IconButton
                            className="btn-sm soft-danger"
                            icon={<IconTrash size={14} />}
                            label={t.delete}
                            onClick={() => removeStaged(f.path)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                <button className="btn primary" disabled={busy} onClick={startImport}>
                  <IconPlus size={14} /> {busy ? t.loading : t.importStockFiles}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="error-text" style={{ marginTop: 8 }}>
          {error}
        </div>
      )}
      {summary && (
        <div className="hint" style={{ marginTop: 8 }}>
          {t.rowsImported}: {(summary.rawCount ?? 0) + (summary.componentCount ?? 0)} ·{' '}
          {t.rowsUnmatched}: {summary.unmatched}
        </div>
      )}

      {pricesLoading && (
        <div className="prices-loading-banner" role="status" aria-live="polite">
          <span className="spinner-dot" aria-hidden="true" />
          <span className="prices-loading-text">{t.bsxPricesLoading}</span>
          <span className="prices-loading-sub">{t.bsxPricesLoadingHint}</span>
        </div>
      )}

      {rawRows.length === 0 && compRows.length === 0 && <div className="card">{t.noStockYet}</div>}

      {renderSnapshotCard('raw', rawRows, rawSnapshot)}
      {renderSnapshotCard('component', compRows, compSnapshot)}

      <div className="hint" style={{ marginTop: 8 }}>
        {t.rawMaterials}: {rawMaterials.length} · {t.components}: {components.length}
      </div>

      {conflicts.length > 0 && (
        <StockConflictModal
          conflicts={conflicts}
          onApply={(resolutions) => void handleResolveConflicts(resolutions)}
          onCancel={() => setConflicts([])}
        />
      )}

      {editingRow && (
        <EditRowDialog
          row={editingRow.row}
          onChange={(next) => setEditingRow({ ...editingRow, row: next })}
          onSave={onSaveEditing}
          onCancel={() => setEditingRow(null)}
        />
      )}

      {confirmDeleteRow && (
        <ConfirmDialog
          message={`${t.stockDeleteRow}: ${confirmDeleteRow.row.name}?`}
          onConfirm={onDeleteRow}
          onCancel={() => setConfirmDeleteRow(null)}
          danger
        />
      )}

      {resolveQueue.length > 0 && (
        <UnmatchedRowModal
          row={resolveQueue[0].row}
          kind={resolveQueue[0].kind}
          busy={adoptBusy}
          error={resolveError}
          onResolve={(action) => void handleResolve(action)}
          onCancel={() => {
            setResolveError(null);
            handleCancelQueue();
          }}
        />
      )}

      {bulkResolve && (
        <BulkUnmatchedModal
          rows={bulkResolve.rows}
          kind={bulkResolve.kind}
          busy={adoptBusy}
          errors={bulkResolve.errors}
          onApply={(decisions) => void handleBulkApply(decisions)}
          onCancel={() => setBulkResolve(null)}
        />
      )}

      {confirmDeleteSnapshot && (
        <ConfirmDialog
          message={t.stockDeleteSnapshotConfirm.replace(
            '{kind}',
            confirmDeleteSnapshot === 'raw' ? t.rawMaterials : t.components,
          )}
          onConfirm={onDeleteSnapshot}
          onCancel={() => setConfirmDeleteSnapshot(null)}
          danger
        />
      )}

      {onNavigate && (
        <button
          className="floating-next"
          onClick={() => onNavigate('shortageReport')}
        >
          <span className="floating-next-step">2</span>
          <span className="floating-next-text">
            <span className="floating-next-hint">{t.nextStep}</span>
            <span>{t.shortageReport}</span>
          </span>
          <span className="floating-next-arrow">→</span>
        </button>
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

interface EditRowProps {
  row: StockRow;
  onChange: (r: StockRow) => void;
  onSave: () => void;
  onCancel: () => void;
}

const EditRowDialog: React.FC<EditRowProps> = ({ row, onChange, onSave, onCancel }) => {
  const t = useT();
  useEscapeKey(onCancel);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconEdit size={18} />}
          tone="edit"
          title={t.stockEditRow}
          subtitle={row.name}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="form-row">
            <label>{t.name}</label>
            <input
              className="input"
              value={row.name}
              onChange={(e) => onChange({ ...row, name: e.target.value })}
            />
          </div>
          <div className="form-row">
            <label>{t.symbol}</label>
            <input
              className="input"
              value={row.mpFirmaSymbol ?? ''}
              onChange={(e) => onChange({ ...row, mpFirmaSymbol: e.target.value || undefined })}
            />
          </div>
          <div className="form-row">
            <label>{t.stockManufacturer}</label>
            <input
              className="input"
              value={row.manufacturerSymbol ?? ''}
              onChange={(e) =>
                onChange({ ...row, manufacturerSymbol: e.target.value || undefined })
              }
            />
          </div>
          <div className="form-row">
            <label>{t.stockWarehouse}</label>
            <input
              className="input"
              value={row.warehouse ?? ''}
              onChange={(e) => onChange({ ...row, warehouse: e.target.value || undefined })}
            />
          </div>
          <div className="form-row">
            <label>{t.quantity}</label>
            <NumberInput
              className="input"
              step="0.01"
              value={row.qty}
              emptyValue={0}
              onChange={(v) => onChange({ ...row, qty: v ?? 0 })}
            />
          </div>
          <div className="form-row">
            <label>{t.stockNetUnit}</label>
            <NumberInput
              className="input"
              step="0.01"
              value={row.netPrice}
              onChange={(v) => onChange({ ...row, netPrice: v })}
            />
          </div>
          <div className="form-row">
            <label>{t.stockVatUnit}</label>
            <NumberInput
              className="input"
              step="0.01"
              value={row.vatPrice}
              onChange={(v) => onChange({ ...row, vatPrice: v })}
            />
          </div>
          <div className="form-row">
            <label>{t.stockGrossUnit}</label>
            <NumberInput
              className="input"
              step="0.01"
              value={row.grossPrice}
              onChange={(v) => onChange({ ...row, grossPrice: v })}
            />
          </div>
          <div className="form-row">
            <label>{t.currency}</label>
            <input
              className="input"
              value={row.currency ?? ''}
              onChange={(e) => onChange({ ...row, currency: e.target.value || undefined })}
            />
          </div>
          <div className="form-row">
            <label>{t.stockNetTotal}</label>
            <NumberInput
              className="input"
              step="0.01"
              value={row.oNet}
              onChange={(v) => onChange({ ...row, oNet: v })}
            />
          </div>
          <div className="form-row">
            <label>{t.stockVatTotal}</label>
            <NumberInput
              className="input"
              step="0.01"
              value={row.oVat}
              onChange={(v) => onChange({ ...row, oVat: v })}
            />
          </div>
          <div className="form-row">
            <label>{t.stockGrossTotal}</label>
            <NumberInput
              className="input"
              step="0.01"
              value={row.oGross}
              onChange={(v) => onChange({ ...row, oGross: v })}
            />
          </div>
          <div className="form-row">
            <label>{t.notes}</label>
            <textarea
              value={row.notes ?? ''}
              onChange={(e) => onChange({ ...row, notes: e.target.value || undefined })}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className="btn primary-filled" onClick={onSave}>
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------- Stock conflict reconciliation ----------
// Shown after an import when manually-edited catalog stock disagrees with the
// imported value. The user decides, per item or in bulk, whether to keep the
// current (manual) value or take the imported one. Default is 'keep' so manual
// corrections are never lost without an explicit choice.

interface StockConflictModalProps {
  conflicts: StockConflict[];
  onApply: (resolutions: StockConflictResolution[]) => void;
  onCancel: () => void;
}

const conflictKey = (c: StockConflict) => `${c.kind}:${c.itemId}`;

const StockConflictModal: React.FC<StockConflictModalProps> = ({
  conflicts,
  onApply,
  onCancel,
}) => {
  const t = useT();
  useEscapeKey(onCancel);
  const [actions, setActions] = useState<Record<string, 'keep' | 'take'>>(() =>
    Object.fromEntries(conflicts.map((c) => [conflictKey(c), 'keep' as const])),
  );

  const setAll = (action: 'keep' | 'take') =>
    setActions(Object.fromEntries(conflicts.map((c) => [conflictKey(c), action])));

  const apply = () => {
    onApply(
      conflicts.map((c) => ({
        itemId: c.itemId,
        kind: c.kind,
        action: actions[conflictKey(c)] ?? 'keep',
        importedQty: c.importedQty,
        importSourceFile: c.importSourceFile,
      })),
    );
  };

  const fmtQty = (qty: number | undefined, unit?: string) =>
    qty === undefined ? '—' : `${qty.toLocaleString()}${unit ? ` ${unit}` : ''}`;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconImport size={18} />}
          tone="edit"
          title={t.stockConflictTitle}
          subtitle={t.stockConflictSubtitle.replace('{n}', String(conflicts.length))}
          onClose={onCancel}
        />
        <div className="modal-body">
          <div className="apply-all-row">
            <span className="apply-all-label">{t.applyToAllLabel}</span>
            <button className="btn btn-sm" onClick={() => setAll('keep')}>
              {t.stockConflictKeepAll}
            </button>
            <button className="btn btn-sm" onClick={() => setAll('take')}>
              {t.stockConflictTakeAll}
            </button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th className="num">{t.stockConflictCurrent}</th>
                  <th className="num">{t.stockConflictImported}</th>
                  <th className="col-w-md">{t.stockConflictDecision}</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => {
                  const key = conflictKey(c);
                  const action = actions[key] ?? 'keep';
                  return (
                    <tr key={key}>
                      <td className="col-wrap">{c.name}</td>
                      <td className="num">
                        {fmtQty(c.currentQty, c.unit)}
                        {c.currentUpdatedAt && (
                          <div className="hint" style={{ fontSize: 11 }}>
                            {new Date(c.currentUpdatedAt).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="num">{fmtQty(c.importedQty, c.unit)}</td>
                      <td>
                        <SegmentedControl
                          size="sm"
                          ariaLabel={c.name}
                          value={action}
                          onChange={(v) => setActions((p) => ({ ...p, [key]: v }))}
                          options={[
                            { value: 'keep', label: t.stockConflictKeep, tone: 'neutral' },
                            { value: 'take', label: t.stockConflictTake, tone: 'success' },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className="btn primary-filled" onClick={apply}>
            {t.stockConflictApply}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockImport;
