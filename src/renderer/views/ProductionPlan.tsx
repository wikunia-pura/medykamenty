import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  ProductionPlan,
  Product,
  ShortageReportEntry,
  EmailBatch,
} from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SkeletonRows from '../components/SkeletonRows';
import { useMinimumLoading } from '../utils/useMinimumLoading';
import NoProductsEmptyState from '../components/NoProductsEmptyState';
import NoPlansEmptyState from '../components/NoPlansEmptyState';
import type { ViewKey } from './types';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import { IconEdit, IconTrash, IconPlus, IconDuplicate } from '../components/Icons';
import IconButton from '../components/IconButton';
import ExportImportButtons from '../components/ExportImportButtons';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import { useColumnResize } from '../utils/useColumnResize';
import { sortRows, type SortValue } from '../utils/sortRows';
import PlanEditorModal from '../components/PlanEditorModal';
import HoverTooltip from '../components/HoverTooltip';
import PlanReportsPopover from '../components/PlanReportsPopover';
import {
  exportPlansJson,
  importPlansJson,
  saveFile,
  openFile,
  formatStats,
  ImportSaveError,
} from '../utils/exportImport';
import { localDateIso } from '../../shared/dates';

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

interface Props {
  editPlanId?: string;
  onEditPlanIdConsumed?: () => void;
  initialSearch?: string;
  onInitialSearchConsumed?: () => void;
  onNavigateToReport?: (planId: string, reportId: string) => void;
  onNavigateToBatch?: (batchId: string) => void;
  onNavigate?: (key: ViewKey) => void;
}

const ProductionPlanView: React.FC<Props> = ({
  editPlanId,
  onEditPlanIdConsumed,
  initialSearch,
  onInitialSearchConsumed,
  onNavigateToReport,
  onNavigateToBatch,
  onNavigate,
}) => {
  const t = useT();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reports, setReports] = useState<ShortageReportEntry[]>([]);
  const [batches, setBatches] = useState<EmailBatch[]>([]);
  const [editing, setEditing] = useState<Partial<ProductionPlan> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProductionPlan | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  // A failed first load — must not read as "no products / no plans yet".
  const [loadError, setLoadError] = useState<string | null>(null);
  // Save error of the plan editor, shown inside the modal.
  const [editError, setEditError] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const showSkeleton = useMinimumLoading(initialLoading);

  const COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.planName, required: true },
      { id: 'status', label: t.planStatusColumn, defaultVisible: true },
      { id: 'items', label: t.planItems, defaultVisible: true },
      { id: 'bulk', label: t.bulkMass, defaultVisible: false },
      { id: 'created', label: t.planCreatedAt, defaultVisible: false },
      { id: 'updated', label: t.planUpdatedAt, defaultVisible: false },
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
  } = useColumnPrefs('plans', COLUMNS);
  const { decorateHeader } = useColumnResize(setWidth, { sort, toggleSort });

  const filteredPlans = useMemo(() => {
    if (!query.trim()) return plans;
    return plans.filter((p) => {
      const productNames = (p.items ?? [])
        .map((i) => products.find((pp) => pp.id === i.productId)?.name ?? '')
        .join(' ');
      return matchesQuery({ ...p, productNames }, query);
    });
  }, [plans, products, query]);

  const reload = async () => {
    const [ps, prods, rs, bs] = await Promise.all([
      window.electronAPI.listPlans(),
      window.electronAPI.listProducts(),
      window.electronAPI.listShortageReports(),
      window.electronAPI.listEmailBatches(),
    ]);
    setPlans(ps);
    setProducts(prods);
    setReports(rs);
    setBatches(bs);
  };

  const reportsByPlan = useMemo(() => {
    const map = new Map<string, ShortageReportEntry[]>();
    for (const r of reports) {
      const arr = map.get(r.planId) ?? [];
      arr.push(r);
      map.set(r.planId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => b.computedAt.localeCompare(a.computedAt));
    }
    return map;
  }, [reports]);

  const batchesByPlan = useMemo(() => {
    const map = new Map<string, EmailBatch[]>();
    for (const b of batches) {
      const arr = map.get(b.planId) ?? [];
      arr.push(b);
      map.set(b.planId, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    }
    return map;
  }, [batches]);

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

  // Open the edit modal for a specific plan when navigated here from elsewhere
  // (e.g. from a shortage report history entry).
  useEffect(() => {
    if (!editPlanId) return;
    const target = plans.find((p) => p.id === editPlanId);
    if (target) {
      setEditError(null);
      setEditing(target);
      onEditPlanIdConsumed?.();
    }
  }, [editPlanId, plans]);

  // Pre-fill the search box when navigated here with an initial query.
  useEffect(() => {
    if (!initialSearch) return;
    setQuery(initialSearch);
    onInitialSearchConsumed?.();
  }, [initialSearch]);

  const openEditor = (p: Partial<ProductionPlan>) => {
    setEditError(null);
    setEditing(p);
  };

  const onAdd = () =>
    openEditor({
      name: `Plan ${localDateIso()}`,
      items: [],
      bulkMass: [],
      status: 'draft',
    });

  // Double submit is guarded inside PlanEditorModal (saving flag).
  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setEditError(null);
    const payload = {
      name: editing.name.trim(),
      items: editing.items ?? [],
      bulkMass: editing.bulkMass ?? [],
      status: editing.status ?? 'draft',
    };
    try {
      if (editing.id) {
        await window.electronAPI.updatePlan(editing.id, payload);
      } else {
        await window.electronAPI.createPlan(payload);
      }
      setEditing(null);
      await reload();
    } catch (err) {
      setEditError(errorMessage(err));
    }
  };

  const onDelete = async (p: ProductionPlan) => {
    setConfirmDelete(null);
    setError(null);
    try {
      await window.electronAPI.deletePlan(p.id);
      setPlans((prev) => prev.filter((x) => x.id !== p.id));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onExport = async () => {
    setError(null);
    setInfo(null);
    if (plans.length === 0) {
      setInfo(t.exportEmpty);
      return;
    }
    setBusy(true);
    setLoaderMessage(t.loaderExporting);
    try {
      const { content, filename } = exportPlansJson(plans, products);
      await saveFile(filename, content, 'json');
    } catch (err) {
      setError(errorMessage(err));
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
      const r = await openFile('json');
      if (!r.ok || !r.content) return;
      try {
        const stats = await importPlansJson(r.content, [...plans], products);
        setInfo(formatStats(stats));
        await reload();
      } catch (err) {
        if (err instanceof ImportSaveError) {
          setError(`${t.importSaveFailed}: ${err.message}`);
          // Plans saved before the failure are kept — show what landed.
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

  const onDuplicate = async (p: ProductionPlan) => {
    if (duplicatingId) return;
    setDuplicatingId(p.id);
    setError(null);
    try {
      const copy = await window.electronAPI.duplicatePlan(p.id);
      openEditor(copy);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDuplicatingId(null);
    }
  };

  const statusInfo = (
    status: ProductionPlan['status'],
  ): { label: string; tooltip: string; cls: string } => {
    switch (status) {
      case 'computed':
        return { label: t.planStatusComputed, tooltip: t.planStatusComputedTooltip, cls: 'success' };
      case 'archived':
        return { label: t.planStatusArchived, tooltip: t.planStatusArchivedTooltip, cls: '' };
      case 'draft':
      default:
        return { label: t.planStatusDraft, tooltip: t.planStatusDraftTooltip, cls: 'warn' };
    }
  };

  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? '?';

  // Header-click sort key per column: what the cell shows — count columns by
  // their count, dates by their ISO timestamp.
  const sortValueFor = (id: string, p: ProductionPlan): SortValue => {
    switch (id) {
      case 'name':
        return p.name;
      case 'status':
        return statusInfo(p.status).label;
      case 'items':
        return (p.items ?? []).length;
      case 'bulk':
        return (p.bulkMass ?? []).length;
      case 'created':
        return p.createdAt;
      case 'updated':
        return p.updatedAt;
      default:
        return undefined;
    }
  };
  const sortedPlans = useMemo(
    () => sortRows(filteredPlans, sort, sortValueFor),
    [filteredPlans, sort, t],
  );

  // A failed load leaves the lists empty too — that is an error, not the
  // "add your first product / plan" empty state.
  if (!showSkeleton && loadError) {
    return (
      <div className="main">
        <div className="page-header">
          <HeaderNav />
          <h1>{t.productionPlan}</h1>
        </div>
        <div className="card">
          <div className="error-text">{loadError}</div>
        </div>
      </div>
    );
  }

  // While loading, the lists are empty for a moment — not an empty state.
  if (!showSkeleton && products.length === 0) {
    return (
      <div className="main">
        <div className="page-header">
          <HeaderNav />
          <h1>{t.productionPlan}</h1>
        </div>
        <NoProductsEmptyState onGoToProducts={() => onNavigate?.('products')} />
        {loaderMessage && <LoadingOverlay message={loaderMessage} />}
      </div>
    );
  }

  if (!showSkeleton && plans.length === 0) {
    return (
      <div className="main">
        <div className="page-header">
          <HeaderNav />
          <h1>{t.productionPlan}</h1>
        </div>
        <NoPlansEmptyState hint={t.addFirstPlanHint} onAddPlan={onAdd} />
        {editing && (
          <PlanEditorModal
            editing={editing}
            products={products}
            setEditing={setEditing}
            onCancel={() => setEditing(null)}
            onSave={onSave}
            error={editError}
          />
        )}
        {loaderMessage && <LoadingOverlay message={loaderMessage} />}
      </div>
    );
  }

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.productionPlan}</h1>
        <span className="page-header-count">{plans.length}</span>
      </div>

      <div className="card card-fill">
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
              widths={widths}
              resetWidth={resetWidth}
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
                {orderedVisibleIds.map((id) => {
                  const th = ((): React.ReactNode => {
                    switch (id) {
                      case 'name':
                        return <th key={id} className="col-w-xl">{t.planName}</th>;
                      case 'status':
                        return <th key={id} className="col-w-md">{t.planStatusColumn}</th>;
                      case 'items':
                        return <th key={id} className="num col-w-sm">{t.planItems}</th>;
                      case 'bulk':
                        return <th key={id} className="num col-w-sm">{t.bulkMass}</th>;
                      case 'created':
                        return <th key={id} className="col-w-md">{t.planCreatedAt}</th>;
                      case 'updated':
                        return <th key={id} className="col-w-md">{t.planUpdatedAt}</th>;
                      default:
                        return null;
                    }
                  })();
                  return decorateHeader(th, id, widths[id]);
                })}
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
                sortedPlans.length === 0 && (
                  <tr>
                    <td colSpan={orderedVisibleIds.length + 2} className="hint">
                      {query ? '—' : t.noData}
                    </td>
                  </tr>
                )
              )}
              {!showSkeleton && sortedPlans.map((p) => {
                const info = statusInfo(p.status);
                const cellFor = (id: string): React.ReactNode => {
                  switch (id) {
                    case 'name':
                      return (
                        <td
                          key={id}
                          className="col-name col-wrap clickable"
                          onClick={() => openEditor(p)}
                        >
                          {p.name}
                        </td>
                      );
                    case 'status': {
                      const planReports = reportsByPlan.get(p.id) ?? [];
                      const planBatches = batchesByPlan.get(p.id) ?? [];
                      const isComputed = p.status === 'computed';
                      const showPopover =
                        isComputed && (planReports.length > 0 || planBatches.length > 0);
                      return (
                        <td key={id}>
                          {showPopover ? (
                            <PlanReportsPopover
                              triggerClassName={`tag ${info.cls} tag-clickable`}
                              trigger={info.label}
                              reports={planReports}
                              batches={planBatches}
                              onSelectReport={(e) =>
                                onNavigateToReport?.(e.planId, e.id)
                              }
                              onSelectBatch={(b) => onNavigateToBatch?.(b.id)}
                            />
                          ) : (
                            <HoverTooltip
                              trigger={<span className={`tag ${info.cls}`}>{info.label}</span>}
                            >
                              <div className="shortage-tooltip-explain">{info.tooltip}</div>
                            </HoverTooltip>
                          )}
                        </td>
                      );
                    }
                    case 'items': {
                      const items = p.items ?? [];
                      if (items.length === 0) {
                        return <td key={id} className="num"><span className="hint">0</span></td>;
                      }
                      return (
                        <td key={id} className="num">
                          <HoverTooltip
                            align="right"
                            triggerClassName="count-bubble"
                            trigger={items.length}
                          >
                            <div className="shortage-tooltip-header">
                              {t.planItems} — {items.length}
                            </div>
                            <ul className="shortage-tooltip-list">
                              {items.map((it, i) => (
                                <li key={`${it.productId}-${i}`}>
                                  <span className="shortage-tooltip-name">
                                    {productName(it.productId)}
                                  </span>
                                  <span className="list-tooltip-amount">
                                    {it.qtyUnits.toLocaleString()} {t.unitsShort}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </HoverTooltip>
                        </td>
                      );
                    }
                    case 'bulk': {
                      const bulk = p.bulkMass ?? [];
                      if (bulk.length === 0) {
                        return <td key={id} className="num"><span className="hint">0</span></td>;
                      }
                      return (
                        <td key={id} className="num">
                          <HoverTooltip
                            align="right"
                            triggerClassName="count-bubble"
                            trigger={bulk.length}
                          >
                            <div className="shortage-tooltip-header">
                              {t.bulkMass} — {bulk.length}
                            </div>
                            <ul className="shortage-tooltip-list">
                              {bulk.map((bm, i) => (
                                <li key={`${bm.productId ?? 'noid'}-${i}`}>
                                  <span className="shortage-tooltip-name">
                                    {productName(bm.productId)}
                                  </span>
                                  <span className="list-tooltip-amount">
                                    {(bm.massKg ?? 0).toLocaleString()} kg
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </HoverTooltip>
                        </td>
                      );
                    }
                    case 'created':
                      return (
                        <td key={id}>{new Date(p.createdAt).toLocaleDateString()}</td>
                      );
                    case 'updated':
                      return (
                        <td key={id}>{new Date(p.updatedAt).toLocaleDateString()}</td>
                      );
                    default:
                      return null;
                  }
                };
                return (
                  <tr key={p.id}>
                    {orderedVisibleIds.map((id) => cellFor(id))}
                    <td className="col-filler" />
                    <td className="actions actions-sticky">
                      <div className="btn-row">
                        <IconButton
                          className="btn-sm soft-danger"
                          icon={<IconTrash size={14} />}
                          label={t.delete}
                          onClick={() => setConfirmDelete(p)}
                        />
                        <IconButton
                          className="btn-sm soft-edit"
                          icon={<IconEdit size={14} />}
                          label={t.edit}
                          onClick={() => openEditor(p)}
                        />
                        <IconButton
                          className="btn-sm soft-success"
                          icon={<IconDuplicate size={14} />}
                          label={t.duplicate}
                          disabled={duplicatingId !== null}
                          onClick={() => void onDuplicate(p)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <PlanEditorModal
          editing={editing}
          products={products}
          setEditing={setEditing}
          onCancel={() => setEditing(null)}
          onSave={onSave}
          error={editError}
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

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

export default ProductionPlanView;
