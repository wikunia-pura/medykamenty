import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type { StockRow, ImportSummary, RawMaterial, PackagingComponent } from '../../shared/types';
import type { ViewKey } from './types';
import DropZone from '../components/DropZone';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import { IconTrash, IconPlus, IconCheck, IconEdit } from '../components/Icons';
import ModalHeader from '../components/ModalHeader';
import { useEscapeKey } from '../utils/useEscapeKey';
import UnmatchedRowModal, { type ResolveAction } from '../components/UnmatchedRowModal';
import BulkUnmatchedModal from '../components/BulkUnmatchedModal';

interface Props {
  onNavigate?: (key: ViewKey) => void;
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

const StockImport: React.FC<Props> = ({ onNavigate }) => {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [rawRows, setRawRows] = useState<StockRow[]>([]);
  const [compRows, setCompRows] = useState<StockRow[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [rawExpanded, setRawExpanded] = useState<boolean>(() => readExpanded(RAW_EXPANDED_KEY));
  const [compExpanded, setCompExpanded] = useState<boolean>(() => readExpanded(COMP_EXPANDED_KEY));
  const [rawSnapshot, setRawSnapshot] = useState<SnapshotInfo>(null);
  const [compSnapshot, setCompSnapshot] = useState<SnapshotInfo>(null);
  const [adoptBusy, setAdoptBusy] = useState(false);
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
  const [confirmDeleteSnapshot, setConfirmDeleteSnapshot] = useState<
    'raw' | 'component' | null
  >(null);
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
  } | null>(null);

  const STOCK_COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.name, required: true },
      { id: 'match', label: 'Match', required: true },
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

  const loadCurrent = async () => {
    const [stock, rms, cs] = await Promise.all([
      window.electronAPI.getCurrentStock(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
    ]);
    setRawRows(stock.raw);
    setCompRows(stock.components);
    setRawMaterials(rms);
    setComponents(cs);
    setRawSnapshot(stock.rawSnapshot);
    setCompSnapshot(stock.componentSnapshot);
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
      await window.electronAPI.resolveStockMatch(
        snapshotId,
        row.rowKey,
        'component',
        created.id,
      );
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
  const applyDecision = async (
    row: StockRow,
    kind: 'raw' | 'component',
    action: ResolveAction,
  ) => {
    const snapshotId = kind === 'raw' ? rawSnapshot?.id : compSnapshot?.id;
    if (!snapshotId) throw new Error('No snapshot to resolve against');
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

  const handleResolve = async (action: ResolveAction) => {
    if (resolveQueue.length === 0) return;
    const head = resolveQueue[0];
    setAdoptBusy(true);
    try {
      await applyDecision(head.row, head.kind, action);
      advanceQueue();
      await loadCurrent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdoptBusy(false);
    }
  };

  const handleBulkApply = async (
    decisions: { row: StockRow; action: ResolveAction }[],
  ) => {
    if (!bulkResolve) return;
    setError(null);
    setAdoptBusy(true);
    setLoaderMessage(t.loaderProcessing);
    try {
      for (const d of decisions) {
        await applyDecision(d.row, bulkResolve.kind, d.action);
      }
      setBulkResolve(null);
      await loadCurrent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
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
    await window.electronAPI.deleteStockRow(snapshotId, row.rowKey);
    await loadCurrent();
  };

  const onDeleteSnapshot = async () => {
    if (!confirmDeleteSnapshot) return;
    const kind = confirmDeleteSnapshot;
    setConfirmDeleteSnapshot(null);
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
    await loadCurrent();
  };

  const onSaveEditing = async () => {
    if (!editingRow) return;
    const { row, snapshotId } = editingRow;
    await window.electronAPI.updateStockRow(snapshotId, row.rowKey, row);
    setEditingRow(null);
    await loadCurrent();
  };

  useEffect(() => {
    void (async () => {
      setLoaderMessage(t.loading);
      try {
        await loadCurrent();
      } finally {
        setLoaderMessage(null);
      }
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

  const removeStaged = (path: string) =>
    setStaged((prev) => prev.filter((f) => f.path !== path));

  const setStagedKind = (path: string, kind: 'raw' | 'component') =>
    setStaged((prev) => prev.map((f) => (f.path === path ? { ...f, kind } : f)));

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

    const headerFor = (id: string): React.ReactNode => {
      switch (id) {
        case 'name':
          return <th key={id} className="col-name-wide">{t.name}</th>;
        case 'match':
          return <th key={id} className="col-w-match">Match</th>;
        case 'qty':
          return <th key={id} className="num col-w-sm">{t.quantity}</th>;
        case 'netUnit':
          return <th key={id} className="num col-w-sm">{t.stockNetUnit}</th>;
        case 'vatUnit':
          return <th key={id} className="num col-w-sm">{t.stockVatUnit}</th>;
        case 'grossUnit':
          return <th key={id} className="num col-w-sm">{t.stockGrossUnit}</th>;
        case 'currency':
          return <th key={id} className="col-w-sm">{t.currency}</th>;
        case 'netTotal':
          return <th key={id} className="num col-w-sm">{t.stockNetTotal}</th>;
        case 'vatTotal':
          return <th key={id} className="num col-w-sm">{t.stockVatTotal}</th>;
        case 'grossTotal':
          return <th key={id} className="num col-w-sm">{t.stockGrossTotal}</th>;
        case 'symbol':
          return <th key={id} className="col-w-md">{t.symbol}</th>;
        case 'manufacturer':
          return <th key={id} className="col-w-md">{t.stockManufacturer}</th>;
        case 'warehouse':
          return <th key={id} className="col-w-md">{t.stockWarehouse}</th>;
        case 'notes':
          return <th key={id} className="col-w-lg">{t.notes}</th>;
        default:
          return null;
      }
    };

    const matchCell = (r: StockRow) => {
      const matchedRow = r.matchedRawMaterialId || r.matchedComponentId;
      if (r.matchAmbiguous) {
        return (
          <span className="match-badge warn" title={t.rowsAmbiguous} aria-label={t.rowsAmbiguous}>
            ?
          </span>
        );
      }
      if (matchedRow) {
        return (
          <span className="match-badge success" title={t.rowsMatched} aria-label={t.rowsMatched}>
            <IconCheck size={12} />
          </span>
        );
      }
      return (
        <button
          className="match-badge danger as-button"
          disabled={adoptBusy}
          onClick={() => openResolveModalFor(r, kind)}
          title={kind === 'raw' ? t.adoptAsRaw : t.adoptAsComponent}
          aria-label={kind === 'raw' ? t.adoptAsRaw : t.adoptAsComponent}
        >
          <IconPlus size={12} />
        </button>
      );
    };

    const cellFor = (id: string, r: StockRow): React.ReactNode => {
      switch (id) {
        case 'name':
          return <td key={id} className="col-name col-wrap">{r.name}</td>;
        case 'match':
          return <td key={id} className="col-match">{matchCell(r)}</td>;
        case 'qty':
          return <td key={id} className="num">{r.qty}</td>;
        case 'netUnit':
          return <td key={id} className="num">{r.netPrice ?? ''}</td>;
        case 'vatUnit':
          return <td key={id} className="num">{r.vatPrice ?? ''}</td>;
        case 'grossUnit':
          return <td key={id} className="num">{r.grossPrice ?? ''}</td>;
        case 'currency':
          return <td key={id}>{r.currency ?? ''}</td>;
        case 'netTotal':
          return <td key={id} className="num">{r.oNet ?? ''}</td>;
        case 'vatTotal':
          return <td key={id} className="num">{r.oVat ?? ''}</td>;
        case 'grossTotal':
          return <td key={id} className="num">{r.oGross ?? ''}</td>;
        case 'symbol':
          return <td key={id}>{r.mpFirmaSymbol ?? ''}</td>;
        case 'manufacturer':
          return <td key={id}>{r.manufacturerSymbol ?? ''}</td>;
        case 'warehouse':
          return <td key={id}>{r.warehouse ?? ''}</td>;
        case 'notes':
          return <td key={id} className="col-wrap">{r.notes ?? ''}</td>;
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
                    title={t.stockUnmatchedOnly}
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
          />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {stockColumns.orderedVisibleIds.map((id) => headerFor(id))}
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={stockColumns.orderedVisibleIds.length + 1}
                    className="hint"
                  >
                    {query || unmatchedOnly ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filtered.slice(0, 200).map((r, idx) => (
                <tr key={`${r.rowKey}-${idx}`}>
                  {stockColumns.orderedVisibleIds.map((id) => cellFor(id, r))}
                  <td className="actions actions-sticky">
                    <div className="btn-row">
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={() => setEditingRow({ row: r, kind, snapshotId })}
                        title={t.stockEditRow}
                      >
                        <IconEdit size={13} /> {t.edit}
                      </button>
                      <button
                        className="btn btn-sm soft-danger"
                        onClick={() => setConfirmDeleteRow({ row: r, snapshotId })}
                        title={t.stockDeleteRow}
                      >
                        <IconTrash size={13} /> {t.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length > 200 && (
                <tr>
                  <td
                    colSpan={stockColumns.orderedVisibleIds.length + 1}
                    className="hint"
                  >
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
              <span style={{ display: 'inline-block', width: 18 }}>
                {expanded ? '▾' : '▸'}
              </span>
              {title} ({rows.length})
            </h2>
            {unmatched > 0 && (
              <span className="tag danger">
                {t.rowsUnmatched}: {unmatched}
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
            title={t.stockDeleteSnapshot}
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
          <span className="page-header-count">
            ({rawRows.length + compRows.length})
          </span>
        )}
      </div>
      <p className="subtitle">
        Import xlsx z MP Firma. Aplikacja dopasuje pozycje do istniejących surowców i komponentów po
        symbolu lub nazwie. Pozycje wieloznaczne lub nierozpoznane można rozstrzygnąć ręcznie.
      </p>

      <div className="card">
        <div className="card-header">
          <div className="card-title">{t.selectXlsxFiles}</div>
        </div>

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
                    <th className="col-w-md">Typ</th>
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
                          onChange={(val) =>
                            setStagedKind(f.path, val as 'raw' | 'component')
                          }
                        />
                      </td>
                      <td className="actions">
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={() => removeStaged(f.path)}
                          title={t.delete}
                        >
                          <IconTrash size={13} /> {t.delete}
                        </button>
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

        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
        {summary && (
          <div className="hint" style={{ marginTop: 8 }}>
            {t.rowsImported}: {(summary.rawCount ?? 0) + (summary.componentCount ?? 0)} ·{' '}
            {t.rowsUnmatched}: {summary.unmatched}
          </div>
        )}
      </div>

      {rawRows.length === 0 && compRows.length === 0 && (
        <div className="card">{t.noStockYet}</div>
      )}

      {renderSnapshotCard('raw', rawRows, rawSnapshot)}
      {renderSnapshotCard('component', compRows, compSnapshot)}

      <div className="hint" style={{ marginTop: 8 }}>
        {t.rawMaterials}: {rawMaterials.length} · {t.components}: {components.length}
      </div>

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
          onResolve={(action) => void handleResolve(action)}
          onCancel={handleCancelQueue}
        />
      )}

      {bulkResolve && (
        <BulkUnmatchedModal
          rows={bulkResolve.rows}
          kind={bulkResolve.kind}
          busy={adoptBusy}
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
          title={t.goToShortageReport}
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

export default StockImport;
