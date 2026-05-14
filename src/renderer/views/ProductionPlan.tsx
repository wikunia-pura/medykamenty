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
import NoProductsEmptyState from '../components/NoProductsEmptyState';
import type { ViewKey } from './types';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import { IconEdit, IconTrash, IconPlus, IconDuplicate } from '../components/Icons';
import ExportImportButtons from '../components/ExportImportButtons';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import PlanEditorModal from '../components/PlanEditorModal';
import HoverTooltip from '../components/HoverTooltip';
import PlanReportsPopover from '../components/PlanReportsPopover';
import {
  exportPlansJson,
  importPlansJson,
  saveFile,
  openFile,
  formatStats,
} from '../utils/exportImport';

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
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);

  const COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.planName, required: true },
      { id: 'status', label: 'Status', defaultVisible: true },
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
    orderedColumns,
    orderedVisibleIds,
  } = useColumnPrefs('plans', COLUMNS);

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
      setLoaderMessage(t.loading);
      try {
        await reload();
      } finally {
        setLoaderMessage(null);
      }
    })();
  }, []);

  // Open the edit modal for a specific plan when navigated here from elsewhere
  // (e.g. from a shortage report history entry).
  useEffect(() => {
    if (!editPlanId) return;
    const target = plans.find((p) => p.id === editPlanId);
    if (target) {
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

  const onAdd = () =>
    setEditing({
      name: `Plan ${new Date().toISOString().slice(0, 10)}`,
      items: [],
      bulkMass: [],
      status: 'draft',
    });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    const payload = {
      name: editing.name.trim(),
      items: editing.items ?? [],
      bulkMass: editing.bulkMass ?? [],
      status: editing.status ?? 'draft',
    };
    if (editing.id) {
      await window.electronAPI.updatePlan(editing.id, payload);
    } else {
      await window.electronAPI.createPlan(payload);
    }
    setEditing(null);
    await reload();
  };

  const onDelete = async (p: ProductionPlan) => {
    setConfirmDelete(null);
    await window.electronAPI.deletePlan(p.id);
    await reload();
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
        setError(`${t.importInvalidFile}: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onDuplicate = async (p: ProductionPlan) => {
    const copy = await window.electronAPI.duplicatePlan(p.id);
    setEditing(copy);
    await reload();
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

  if (products.length === 0) {
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

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.productionPlan}</h1>
        <span className="page-header-count">{plans.length}</span>
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
                {orderedVisibleIds.map((id) => {
                  switch (id) {
                    case 'name':
                      return <th key={id} className="col-w-xl">{t.planName}</th>;
                    case 'status':
                      return <th key={id} className="col-w-md">Status</th>;
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
                })}
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filteredPlans.length === 0 && (
                <tr>
                  <td colSpan={orderedVisibleIds.length + 1} className="hint">
                    {query ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filteredPlans.map((p) => {
                const info = statusInfo(p.status);
                const cellFor = (id: string): React.ReactNode => {
                  switch (id) {
                    case 'name':
                      return <td key={id} className="col-name col-wrap">{p.name}</td>;
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
                              triggerTitle={info.tooltip}
                              trigger={info.label}
                              reports={planReports}
                              batches={planBatches}
                              onSelectReport={(e) =>
                                onNavigateToReport?.(e.planId, e.id)
                              }
                              onSelectBatch={(b) => onNavigateToBatch?.(b.id)}
                            />
                          ) : (
                            <span className={`tag ${info.cls}`} title={info.tooltip}>
                              {info.label}
                            </span>
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
                                    {it.qtyUnits.toLocaleString()} szt.
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
                    <td className="actions actions-sticky">
                      <div className="btn-row">
                        <button
                          className="btn btn-sm soft-edit"
                          onClick={() => setEditing(p)}
                          title={t.edit}
                        >
                          <IconEdit size={13} /> {t.edit}
                        </button>
                        <button
                          className="btn btn-sm soft-success"
                          onClick={() => onDuplicate(p)}
                          title={t.duplicatePlan}
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
