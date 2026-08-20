import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav, useNavigation } from '../navigation';
import type {
  EmailBatch,
  Order,
  ProductionPlan,
  Product,
  RFQEmailRecord,
  ShortageGroup,
  ShortageLine,
  ShortageReport,
  ShortageReportEntry,
  Supplier,
  ExpiredBatchRef,
  DependencyShortageRef,
  PackagingComponent,
} from '../../shared/types';
import type { ViewKey } from './types';
import ExpiredStockModal from '../components/ExpiredStockModal';
import DependencyShortageModal, {
  buildSubstituteCandidates,
} from '../components/DependencyShortageModal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import NoPlansEmptyState from '../components/NoPlansEmptyState';
import {
  IconArchive,
  IconArrowLeft,
  IconCheck,
  IconClose,
  IconEdit,
  IconMail,
  IconPlus,
  IconSettings,
  IconTrash,
} from '../components/Icons';
import SearchableSelect from '../components/SearchableSelect';
import SupplierPickerModal from '../components/SupplierPickerModal';
import PlanEditorModal from '../components/PlanEditorModal';
import ShortageReportTooltip from '../components/ShortageReportTooltip';
import ModalHeader from '../components/ModalHeader';
import { useEscapeKey } from '../utils/useEscapeKey';

interface Props {
  selectedPlanId: string;
  onSelectPlan: (id: string) => void;
  onNavigate: (key: ViewKey) => void;
  onNavigateToEmails: (reportId: string) => void;
  focusReportId?: string;
  onFocusReportConsumed?: () => void;
  // When the view was opened from an order's workflow task, generated reports
  // are linked back to that order so they appear in the order's report list.
  orderTaskContextOrderId?: string;
  // Lets the user jump to an order from the "linked order" pill or column.
  onNavigateToOrder?: (orderId: string) => void;
  taskBanner?: React.ReactNode;
}

type ReportMode = 'preview' | 'edit';

interface FocusState {
  report: ShortageReport;
  planId: string;
  planName: string;
  reportName: string;
  entryId: string | null;
  mode: ReportMode;
  originFromNav?: boolean;
}

// Module-level cache so the focused report survives navigating away and back.
const cache: { focus: FocusState | null } = { focus: null };

export const resetShortageReportFocus = () => {
  cache.focus = null;
};

const ShortageReportView: React.FC<Props> = ({
  selectedPlanId,
  onSelectPlan,
  onNavigate,
  onNavigateToEmails,
  focusReportId,
  onFocusReportConsumed,
  orderTaskContextOrderId,
  onNavigateToOrder,
  taskBanner,
}) => {
  const t = useT();
  const navCtx = useNavigation();
  // True after the initial data fetch (plans, suppliers, products, orders,
  // history). Used to gate the "linked plan / order deleted" warnings so they
  // don't flash during initial render while the lists are still empty.
  const [dataLoaded, setDataLoaded] = useState(false);
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [batches, setBatches] = useState<EmailBatch[]>([]);
  const [supplierActionKey, setSupplierActionKey] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusState | null>(cache.focus);
  const [history, setHistory] = useState<ShortageReportEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [reassigningKey, setReassigningKey] = useState<string | null>(null);
  // Group whose supplier the user is currently changing via the modal.
  // null = modal closed.
  const [groupPickerTarget, setGroupPickerTarget] = useState<ShortageGroup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ShortageReportEntry | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingPlan, setEditingPlan] = useState<Partial<ProductionPlan> | null>(null);
  const [planModalReadOnly, setPlanModalReadOnly] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  // Expired-stock gate: when the plan's materials have expired batches, the
  // user decides per-run which to count. `pendingExpired` drives the modal;
  // `expiredIncludeIds` remembers the decision so recomputes (e.g. after a
  // supplier reassign) stay consistent without re-prompting.
  const [pendingExpired, setPendingExpired] = useState<
    { batches: ExpiredBatchRef[]; planId: string; planName: string } | null
  >(null);
  const [expiredIncludeIds, setExpiredIncludeIds] = useState<string[]>([]);
  // "Zużywa"-shortage gate: when a cascade-consumed component (tape via
  // carton) would run short, the user decides per-run whether to accept the
  // shortage (a substitute exists — leave it out) or count it normally.
  // `acceptedDepIds` remembers the decision for recomputes.
  const [pendingDeps, setPendingDeps] = useState<
    { refs: DependencyShortageRef[]; planId: string; expiredIds: string[] } | null
  >(null);
  const [acceptedDepIds, setAcceptedDepIds] = useState<string[]>([]);
  const [depSubstitutions, setDepSubstitutions] = useState<Record<string, string>>({});
  // Full component catalog — used to offer substitution candidates in the
  // shared-packaging shortage prompt.
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  // Editable copy of the "count this expired batch?" decision shown on the
  // generated report, so the user can change their mind and regenerate. Synced
  // from the report's own `included` flags whenever a fresh report loads.
  const [expiredDraft, setExpiredDraft] = useState<Set<string>>(new Set());

  // Re-seed the expired-batch draft from whichever report is in focus.
  useEffect(() => {
    const eb = focus?.report?.expiredBatches ?? [];
    setExpiredDraft(new Set(eb.filter((b) => b.included).map((b) => b.batchId)));
  }, [focus?.report?.computedAt, focus?.entryId]);

  const openPlanModal = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    setEditingPlan({ ...plan });
    setPlanModalReadOnly(true);
  };

  const setFocusAndCache = (next: FocusState | null) => {
    setFocus(next);
    cache.focus = next;
  };

  const loadHistory = async () => {
    const list = await window.electronAPI.listShortageReports();
    setHistory(list);
    return list;
  };

  const reloadPlans = async () => {
    const ps = await window.electronAPI.listPlans();
    setPlans(ps);
    return ps;
  };

  const loadBatches = async () => {
    try {
      const bs = await window.electronAPI.listEmailBatches();
      setBatches(bs);
      return bs;
    } catch (err) {
      console.error('Failed to load email batches', err);
      return [];
    }
  };

  useEffect(() => {
    void (async () => {
      setLoaderMessage(t.loading);
      try {
        const [ps, ss, pr, os, bs, cs] = await Promise.all([
          window.electronAPI.listPlans(),
          window.electronAPI.listSuppliers(),
          window.electronAPI.listProducts(),
          window.electronAPI.listOrders().catch(() => [] as Order[]),
          window.electronAPI.listEmailBatches().catch(() => [] as EmailBatch[]),
          window.electronAPI.listComponents().catch(() => [] as PackagingComponent[]),
        ]);
        setPlans(ps);
        setSuppliers(ss);
        setProducts(pr);
        setOrders(os);
        setBatches(bs);
        setComponents(cs);
        if (!selectedPlanId && ps[0]) onSelectPlan(ps[0].id);
        await loadHistory();
        setDataLoaded(true);
      } finally {
        setLoaderMessage(null);
      }
    })();
  }, []);

  // Open a specific report when navigated here from another view.
  useEffect(() => {
    if (!focusReportId) return;
    const entry = history.find((e) => e.id === focusReportId);
    if (entry) {
      openEntry(entry, 'preview', true);
      onFocusReportConsumed?.();
    }
  }, [focusReportId, history]);

  const openAddPlan = () => {
    setPlanModalReadOnly(false);
    setEditingPlan({
      name: `Plan ${new Date().toISOString().slice(0, 10)}`,
      items: [],
      bulkMass: [],
      status: 'draft',
    });
  };

  const closePlanModal = () => {
    setEditingPlan(null);
    setPlanModalReadOnly(false);
  };

  const savePlan = async () => {
    if (!editingPlan || !editingPlan.name?.trim()) return;
    const payload = {
      name: editingPlan.name.trim(),
      items: editingPlan.items ?? [],
      bulkMass: editingPlan.bulkMass ?? [],
      status: editingPlan.status ?? 'draft',
    };
    const created = editingPlan.id
      ? await window.electronAPI.updatePlan(editingPlan.id, payload)
      : await window.electronAPI.createPlan(payload);
    closePlanModal();
    const ps = await reloadPlans();
    // Auto-select the freshly created plan so user can immediately compute.
    if (created && !editingPlan.id) {
      const newId = (created as ProductionPlan).id;
      if (newId && ps.some((p) => p.id === newId)) onSelectPlan(newId);
    }
  };

  // Runs the actual shortage computation + focuses the fresh report.
  const runCompute = async (
    planId: string,
    includeExpiredBatchIds: string[],
    acceptedDependencyIds: string[],
    substitutions: Record<string, string>,
  ) => {
    const plan = plans.find((p) => p.id === planId);
    setBusy(true);
    setLoaderMessage(t.loaderComputing);
    setError(null);
    try {
      const r = await window.electronAPI.computeShortages(
        planId,
        orderTaskContextOrderId,
        includeExpiredBatchIds,
        acceptedDependencyIds,
        substitutions,
      );
      const list = await loadHistory();
      const newest = list.find((e) => e.planId === planId);
      setFocusAndCache({
        report: r,
        planId,
        planName: plan?.name ?? '',
        reportName: newest?.reportName ?? '',
        entryId: newest?.id ?? null,
        mode: 'edit',
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  // Second gate (after the expired one): shortages of components consumed
  // only via the "zużywa" cascade. If any exist, ask the user before the real
  // compute; otherwise compute straight away with nothing accepted.
  const gateDependencyShortages = async (planId: string, includeExpiredBatchIds: string[]) => {
    setBusy(true);
    setLoaderMessage(t.loaderComputing);
    try {
      const refs = await window.electronAPI.previewDependencyShortages(
        planId,
        includeExpiredBatchIds,
      );
      if (refs.length > 0) {
        setPendingDeps({ refs, planId, expiredIds: includeExpiredBatchIds });
        return;
      }
    } catch {
      // If the preview fails, fall through and compute with every shortage counted.
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
    setAcceptedDepIds([]);
    setDepSubstitutions({});
    await runCompute(planId, includeExpiredBatchIds, [], {});
  };

  const compute = async () => {
    if (!selectedPlanId) return;
    const plan = plans.find((p) => p.id === selectedPlanId);
    setError(null);
    // Gate on expired stock first: if the plan's materials have expired
    // batches, let the user decide (per run) which to count before computing.
    try {
      const expired = await window.electronAPI.previewExpiredForPlan(selectedPlanId);
      if (expired.length > 0) {
        setPendingExpired({ batches: expired, planId: selectedPlanId, planName: plan?.name ?? '' });
        return;
      }
    } catch {
      // If the preview fails, fall through and compute with expired excluded.
    }
    setExpiredIncludeIds([]);
    await gateDependencyShortages(selectedPlanId, []);
  };

  const reassignSupplier = async (line: ShortageLine, newSupplierId: string) => {
    if (!focus || focus.mode !== 'edit') return;
    const key = `${line.itemKind}-${line.itemId}`;
    setReassigningKey(key);
    setError(null);
    try {
      const next = newSupplierId || undefined;
      if (line.itemKind === 'raw') {
        const rm = await window.electronAPI.getRawMaterial(line.itemId);
        if (!rm) throw new Error(`Raw material ${line.itemId} not found`);
        const merged = next
          ? Array.from(new Set([...(rm.supplierIds ?? []), next]))
          : rm.supplierIds ?? [];
        await window.electronAPI.updateRawMaterial(line.itemId, {
          supplierIds: merged,
          preferredSupplierId: next,
        });
      } else {
        const c = await window.electronAPI.getComponent(line.itemId);
        if (!c) throw new Error(`Component ${line.itemId} not found`);
        const merged = next
          ? Array.from(new Set([...(c.supplierIds ?? []), next]))
          : c.supplierIds ?? [];
        await window.electronAPI.updateComponent(line.itemId, {
          supplierIds: merged,
          preferredSupplierId: next,
        });
      }
      const r = await window.electronAPI.computeShortages(
        focus.planId,
        orderTaskContextOrderId,
        expiredIncludeIds,
        acceptedDepIds,
        depSubstitutions,
      );
      const list = await loadHistory();
      const newest = list.find((e) => e.planId === focus.planId);
      setFocusAndCache({ ...focus, report: r, entryId: newest?.id ?? null });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReassigningKey(null);
    }
  };

  // Bulk-reassign every line in `group` to `newSupplierId` — propagates the
  // change to each underlying raw material / component (adds the supplier to
  // `supplierIds`, sets it as `preferredSupplierId`) and re-runs the shortage
  // compute so the line moves to the new group on screen.
  const reassignGroup = async (group: ShortageGroup, newSupplierId: string) => {
    if (!focus || focus.mode !== 'edit') return;
    if (!newSupplierId || newSupplierId === group.supplierId) return;
    setBusy(true);
    setLoaderMessage(t.loading);
    setError(null);
    try {
      const lines = [...group.rawLines, ...group.componentLines];
      for (const line of lines) {
        if (line.itemKind === 'raw') {
          const rm = await window.electronAPI.getRawMaterial(line.itemId);
          if (!rm) continue;
          const merged = Array.from(new Set([...(rm.supplierIds ?? []), newSupplierId]));
          await window.electronAPI.updateRawMaterial(line.itemId, {
            supplierIds: merged,
            preferredSupplierId: newSupplierId,
          });
        } else {
          const c = await window.electronAPI.getComponent(line.itemId);
          if (!c) continue;
          const merged = Array.from(new Set([...(c.supplierIds ?? []), newSupplierId]));
          await window.electronAPI.updateComponent(line.itemId, {
            supplierIds: merged,
            preferredSupplierId: newSupplierId,
          });
        }
      }
      const r = await window.electronAPI.computeShortages(
        focus.planId,
        orderTaskContextOrderId,
        expiredIncludeIds,
        acceptedDepIds,
        depSubstitutions,
      );
      const list = await loadHistory();
      const newest = list.find((e) => e.planId === focus.planId);
      setFocusAndCache({ ...focus, report: r, entryId: newest?.id ?? null });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
      setGroupPickerTarget(null);
    }
  };

  // Detect whether a group contains raw materials, components, or a mix —
  // drives the supplier-type filter on the picker so the user only sees
  // suppliers relevant to what they're reassigning.
  const groupTypeFilter = (group: ShortageGroup): 'raw' | 'component' | undefined => {
    const hasRaw = group.rawLines.length > 0;
    const hasComp = group.componentLines.length > 0;
    if (hasRaw && !hasComp) return 'raw';
    if (hasComp && !hasRaw) return 'component';
    return undefined;
  };

  const openEntry = (
    entry: ShortageReportEntry,
    mode: ReportMode,
    originFromNav = false,
  ) => {
    onSelectPlan(entry.planId);
    setError(null);
    setFocusAndCache({
      report: entry.report,
      planId: entry.planId,
      planName: entry.planName,
      reportName: entry.reportName,
      entryId: entry.id,
      mode,
      originFromNav,
    });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const exitFocus = () => {
    setFocusAndCache(null);
    setError(null);
  };

  const handleBack = () => {
    if (focus?.originFromNav && navCtx?.canGoBack) {
      navCtx.goBack();
    } else {
      exitFocus();
    }
  };

  const commitTitleRename = async () => {
    if (!focus || titleDraft === null) return;
    const next = titleDraft.trim();
    setTitleDraft(null);
    if (!next || next === focus.reportName) return;
    if (!focus.entryId) {
      setError('Cannot rename a report that has not been saved yet.');
      return;
    }
    try {
      await window.electronAPI.updateShortageReport(focus.entryId, { reportName: next });
      setFocusAndCache({ ...focus, reportName: next });
      await loadHistory();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onConfirmDelete = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    await window.electronAPI.deleteShortageReport(id);
    if (focus?.entryId === id) setFocusAndCache(null);
    await loadHistory();
  };

  const onConfirmDeleteAll = async () => {
    setConfirmDeleteAll(false);
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.deleteAllInProgress);
    const total = history.length;
    try {
      for (const e of history) {
        await window.electronAPI.deleteShortageReport(e.id);
      }
      setInfo(t.deleteAllSuccess.replace('{n}', String(total)));
      setFocusAndCache(null);
      await loadHistory();
    } catch (err) {
      setError((err as Error).message);
      await loadHistory();
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const fmt = (n: number, unit: ShortageLine['unit']) =>
    n.toFixed(unit === 'pcs' ? 0 : 2);

  const hasPlans = plans.length > 0;

  // ID of the report whose order link is being changed. Drives the
  // ReportOrderPicker overlay (rendered in both list and focus return paths
  // below). null = picker closed.
  const [pickerEntryId, setPickerEntryId] = useState<string | null>(null);

  const setReportOrder = async (entryId: string, orderId: string | null) => {
    setBusy(true);
    try {
      await window.electronAPI.updateShortageReport(entryId, { orderId });
      const list = await loadHistory();
      if (focus?.entryId === entryId) {
        const updated = list.find((e) => e.id === entryId);
        if (updated) {
          // Keep the focused state aligned with the new orderId so the meta
          // line refreshes immediately.
          setFocusAndCache({ ...focus, entryId: updated.id });
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setPickerEntryId(null);
    }
  };

  const setReportArchived = async (entryId: string, archived: boolean) => {
    setBusy(true);
    try {
      await window.electronAPI.updateShortageReport(entryId, { archived });
      await loadHistory();
      // The cascade also flips the archived flag on linked email batches,
      // so refresh that cache too.
      await loadBatches();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // For a given supplier group, find the latest RFQ email record across all
  // email batches that were generated from the currently focused report.
  // Returns the most-recent match (or null if none) so the user can toggle
  // its sent status directly from the shortage report view.
  const findLatestEmailForGroup = (
    g: ShortageGroup,
  ): { batch: EmailBatch; email: RFQEmailRecord } | null => {
    if (!focus?.entryId) return null;
    const reportBatches = batches
      .filter((b) => b.reportId === focus.entryId)
      .sort(
        (a, b) =>
          new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
      );
    for (const b of reportBatches) {
      const email = b.emails.find((e) => {
        if (g.supplierId) return e.supplierId === g.supplierId;
        // Unassigned group: match the email with no supplierId.
        return !e.supplierId;
      });
      if (email) return { batch: b, email };
    }
    return null;
  };

  const supplierReceiptKey = (g: ShortageGroup): string => g.supplierId ?? '__none__';

  const getGroupReceipt = (g: ShortageGroup): { receivedAt: string } | null => {
    const entry = focus?.entryId
      ? history.find((e) => e.id === focus.entryId)
      : null;
    const key = supplierReceiptKey(g);
    const found = (entry?.supplierReceipts ?? []).find(
      (r) => r.supplierId === key,
    );
    return found ? { receivedAt: found.receivedAt } : null;
  };

  const toggleEmailSentForGroup = async (g: ShortageGroup) => {
    const match = findLatestEmailForGroup(g);
    if (!match) return;
    const actionKey = `mail:${supplierReceiptKey(g)}`;
    setSupplierActionKey(actionKey);
    setError(null);
    try {
      const nextSentAt = match.email.sentAt ? null : new Date().toISOString();
      await window.electronAPI.markEmailSent(
        match.batch.id,
        match.email.id,
        nextSentAt,
      );
      await loadBatches();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSupplierActionKey(null);
    }
  };

  const toggleReceiptForGroup = async (g: ShortageGroup) => {
    if (!focus?.entryId) return;
    const actionKey = `receipt:${supplierReceiptKey(g)}`;
    setSupplierActionKey(actionKey);
    setError(null);
    try {
      const current = getGroupReceipt(g);
      const nextReceivedAt = current ? null : new Date().toISOString();
      await window.electronAPI.setReportSupplierReceived(
        focus.entryId,
        supplierReceiptKey(g),
        nextReceivedAt,
      );
      await loadHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSupplierActionKey(null);
    }
  };

  // ----- Focused view (compute / edit / preview a single report) -----
  if (focus) {
    const { report, mode, reportName } = focus;
    const linkedPlan = focus.planId
      ? plans.find((p) => p.id === focus.planId)
      : undefined;
    const planMissing = dataLoaded && !!focus.planId && !linkedPlan;
    const livePlanName = linkedPlan?.name ?? focus.planName;
    const focusedEntry = focus.entryId
      ? history.find((e) => e.id === focus.entryId)
      : null;
    const focusOrderId = focusedEntry?.orderId;
    const linkedOrder = focusOrderId ? orders.find((o) => o.id === focusOrderId) : null;
    const orderMissing = dataLoaded && !!focusOrderId && !linkedOrder;
    return (
      <div className="main">
        <div className="focus-bar">
          <button className="btn" onClick={handleBack} title={t.backToList}>
            <IconArrowLeft size={14} /> {t.backToList}
          </button>
          <div className="focus-bar-text">
            {titleDraft !== null ? (
              <input
                autoFocus
                className="focus-bar-title-input"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => void commitTitleRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitTitleRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setTitleDraft(null);
                  }
                }}
              />
            ) : (
              <h1
                className="focus-bar-title focus-bar-title-editable"
                onClick={() => setTitleDraft(reportName || '')}
                title={t.edit}
              >
                {reportName || t.shortageReport}
                <IconEdit size={13} className="focus-bar-title-pencil" />
              </h1>
            )}
            {focus.planId && livePlanName && (
              <span className="focus-bar-meta">
                <span className="hint">{t.selectedPlan}:</span>{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => openPlanModal(focus.planId)}
                  title={planMissing ? t.linkedPlanDeleted : t.openPlan}
                  disabled={planMissing}
                >
                  {livePlanName}
                </button>
                {planMissing && (
                  <span
                    className="tag danger"
                    style={{ marginLeft: 6 }}
                    title={t.linkedPlanDeleted}
                  >
                    {t.linkedPlanDeletedTag}
                  </span>
                )}
              </span>
            )}
            {focus.entryId && (
              <span className="focus-bar-meta">
                <span className="hint">{t.orders}:</span>{' '}
                {linkedOrder ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onNavigateToOrder?.(linkedOrder.id)}
                    title={t.orderDetails}
                  >
                    {linkedOrder.name}
                  </button>
                ) : orderMissing ? (
                  <span className="tag danger" title={t.orderDeleted}>
                    {t.orderDeletedTag}
                  </span>
                ) : (
                  <span className="hint">—</span>
                )}
              </span>
            )}
          </div>
          <div className="btn-row">
            {focus.entryId && (
              <>
                {focusOrderId ? (
                  <button
                    className="btn soft-danger"
                    onClick={() => void setReportOrder(focus.entryId!, null)}
                    title={t.unlinkOrder}
                  >
                    <IconClose size={13} /> {t.unlinkOrder}
                  </button>
                ) : (
                  <button
                    className="btn soft-edit"
                    onClick={() => {
                      if (orderTaskContextOrderId) {
                        void setReportOrder(focus.entryId!, orderTaskContextOrderId);
                      } else {
                        setPickerEntryId(focus.entryId);
                      }
                    }}
                    disabled={orders.length === 0}
                    title={t.linkOrder}
                  >
                    <IconPlus size={13} /> {t.linkOrder}
                  </button>
                )}
              </>
            )}
            {mode === 'preview' ? (
              <button
                className="btn primary"
                onClick={() =>
                  setFocusAndCache({ ...focus, mode: 'edit' })
                }
                title={t.editMode}
              >
                <IconEdit size={13} /> {t.edit}
              </button>
            ) : (
              <>
                {focus.entryId && focusedEntry && (
                  <button
                    className="btn soft-neutral"
                    onClick={() =>
                      void setReportArchived(focus.entryId!, !focusedEntry.archived)
                    }
                    title={focusedEntry.archived ? t.unarchiveReport : t.archiveReport}
                    disabled={busy}
                  >
                    <IconArchive size={13} />{' '}
                    {focusedEntry.archived ? t.unarchiveReport : t.archiveReport}
                  </button>
                )}
                <button
                  className="btn primary"
                  onClick={() =>
                    setFocusAndCache({ ...focus, mode: 'preview' })
                  }
                  title={t.finishEditing}
                >
                  <IconCheck size={13} /> {t.finishEditing}
                </button>
              </>
            )}
            <button
              className="btn primary-filled"
              onClick={() => focus.entryId && onNavigateToEmails(focus.entryId)}
              disabled={!focus.entryId || focus.report.groups.length === 0}
              title={t.goToEmailGenerator}
            >
              <IconMail size={13} /> {t.generateEmails}
            </button>
          </div>
        </div>
        {taskBanner}

        {pickerEntryId && (
          <ReportOrderPicker
            orders={orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled')}
            onCancel={() => setPickerEntryId(null)}
            onPick={(orderId) => void setReportOrder(pickerEntryId, orderId)}
          />
        )}

        {error && <div className="card error-text">{error}</div>}

        {planMissing && (
          <div className="card" style={{ borderColor: 'var(--warning)' }}>
            <strong className="warn-text">{t.linkedPlanDeleted}</strong>
          </div>
        )}

        {report.warnings.length > 0 && (
          <div className="card" style={{ borderColor: 'var(--warning)' }}>
            <strong className="warn-text">{t.warnings}</strong>
            <ul>
              {report.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {report.expiredBatches && report.expiredBatches.length > 0 && (
          <div className="card expired-report-panel">
            <strong className="warn-text">{t.expiredStockTitle}</strong>
            <div className="hint" style={{ margin: '4px 0 10px' }}>
              {t.expiredReportPanelHint}
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th className="num">{t.stock}</th>
                    <th>{t.expiry}</th>
                    <th>{t.expiredStockInclude}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.expiredBatches.map((b) => {
                    const on = expiredDraft.has(b.batchId);
                    const retested = !!b.effectiveExpiry && b.effectiveExpiry !== b.originalExpiry;
                    return (
                      <tr key={b.batchId}>
                        <td className="col-wrap">
                          {b.rawMaterialName}
                          {b.note && <div className="hint">{b.note}</div>}
                        </td>
                        <td className="num">
                          {b.qty.toLocaleString()} {b.unit}
                        </td>
                        <td>
                          <span className="stock-batch-flag">
                            {b.effectiveExpiry
                              ? new Date(b.effectiveExpiry).toLocaleDateString()
                              : '—'}
                          </span>
                          {retested && (
                            <div className="hint">
                              {t.expiryOriginal}:{' '}
                              {b.originalExpiry
                                ? new Date(b.originalExpiry).toLocaleDateString()
                                : '—'}
                            </div>
                          )}
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={planMissing}
                            onChange={() =>
                              setExpiredDraft((prev) => {
                                const next = new Set(prev);
                                if (next.has(b.batchId)) next.delete(b.batchId);
                                else next.add(b.batchId);
                                return next;
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <div className="spacer" />
              <button
                className="btn primary-filled"
                disabled={busy || planMissing}
                onClick={() => {
                  const ids = [...expiredDraft];
                  setExpiredIncludeIds(ids);
                  void runCompute(focus.planId, ids, acceptedDepIds, depSubstitutions);
                }}
                title={t.expiredReportRegenerate}
              >
                {t.expiredReportRegenerate}
              </button>
            </div>
          </div>
        )}

        {report.groups.length === 0 && (
          <div className="card">
            <strong>{t.noShortages}</strong>
          </div>
        )}

        {report.groups.map((g) => {
          const lines = [...g.rawLines, ...g.componentLines];
          if (lines.length === 0) return null;
          const groupKey = supplierReceiptKey(g);
          const emailMatch = findLatestEmailForGroup(g);
          const receipt = getGroupReceipt(g);
          const mailBusy = supplierActionKey === `mail:${groupKey}`;
          const receiptBusy = supplierActionKey === `receipt:${groupKey}`;
          const mailSent = !!emailMatch?.email.sentAt;
          return (
            <div key={groupKey} className="card">
              <div className="card-header">
                <div className="card-title">
                  {g.supplierName}{' '}
                  <span className="hint">({lines.length})</span>
                  {g.supplierEmail && (
                    <span className="hint" style={{ marginLeft: 8 }}>
                      &lt;{g.supplierEmail}&gt;
                    </span>
                  )}
                </div>
                <div className="btn-row">
                  {mode === 'edit' && (
                    <button
                      className="btn btn-sm soft-edit"
                      onClick={() => setGroupPickerTarget(g)}
                      title={g.supplierId ? t.changeSupplier : t.assignSupplier}
                    >
                      <IconEdit size={13} />{' '}
                      {g.supplierId ? t.changeSupplier : t.assignSupplier}
                    </button>
                  )}
                  {emailMatch && (
                    <button
                      className={`btn btn-sm ${mailSent ? 'soft-danger' : 'soft-success'}`}
                      onClick={() => void toggleEmailSentForGroup(g)}
                      disabled={mailBusy}
                      title={
                        mailSent
                          ? `${t.sentAtLabel}: ${new Date(emailMatch.email.sentAt!).toLocaleString()}`
                          : t.markSent
                      }
                    >
                      <IconCheck size={13} />{' '}
                      {mailSent ? t.unmarkSent : t.markSent}
                    </button>
                  )}
                  <button
                    className={`btn btn-sm ${receipt ? 'soft-danger' : 'soft-success'}`}
                    onClick={() => void toggleReceiptForGroup(g)}
                    disabled={receiptBusy || !focus.entryId}
                    title={
                      receipt
                        ? `${t.receivedAtLabel}: ${new Date(receipt.receivedAt).toLocaleString()}`
                        : t.markReceived
                    }
                  >
                    <IconCheck size={13} />{' '}
                    {receipt ? t.unmarkReceived : t.markReceived}
                  </button>
                </div>
              </div>
              {(mailSent || receipt) && (
                <div className="supplier-status-row">
                  {mailSent && emailMatch && (
                    <span className="tag success">
                      <IconCheck size={11} /> {t.mailSentBadge}{' '}
                      <span className="hint" style={{ marginLeft: 4 }}>
                        {new Date(emailMatch.email.sentAt!).toLocaleString()}
                      </span>
                    </span>
                  )}
                  {receipt && (
                    <span className="tag success">
                      <IconCheck size={11} /> {t.receivedBadge}{' '}
                      <span className="hint" style={{ marginLeft: 4 }}>
                        {new Date(receipt.receivedAt).toLocaleString()}
                      </span>
                    </span>
                  )}
                </div>
              )}
              <table className="table shortage-table">
                <colgroup>
                  <col style={{ width: '22%' }} />
                  <col style={{ width: 90 }} />
                  <col style={{ width: 200 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 100 }} />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 80 }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th>Typ</th>
                    <th>{t.supplier}</th>
                    <th className="num">{t.required}</th>
                    <th className="num">{t.available}</th>
                    <th className="num">{t.shortage}</th>
                    <th className="num">{t.suggestedOrder}</th>
                    <th className="num">{t.moq}</th>
                    <th>{t.unit}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const key = `${line.itemKind}-${line.itemId}`;
                    return (
                      <tr key={key}>
                        <td className="col-wrap">{line.itemName}</td>
                        <td>
                          <span className="tag">
                            {line.itemKind === 'raw' ? 'surowiec' : 'komponent'}
                          </span>
                        </td>
                        <td>
                          {mode === 'edit' ? (
                            <SearchableSelect
                              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
                              value={line.preferredSupplierId ?? ''}
                              onChange={(val) => reassignSupplier(line, val)}
                              placeholder={t.selectSupplier}
                              disabled={reassigningKey === key}
                            />
                          ) : (
                            <span>
                              {line.preferredSupplierId
                                ? suppliers.find((s) => s.id === line.preferredSupplierId)
                                    ?.name ?? '—'
                                : '—'}
                            </span>
                          )}
                        </td>
                        <td className="num">{fmt(line.required, line.unit)}</td>
                        <td className="num">{fmt(line.available, line.unit)}</td>
                        <td className="num error-text">{fmt(line.shortage, line.unit)}</td>
                        <td className="num">
                          <strong>{fmt(line.suggestedOrder, line.unit)}</strong>
                        </td>
                        <td className="num">{line.moq ?? ''}</td>
                        <td>{line.unit}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        {focus.entryId && focus.report.groups.length > 0 && (
          <button
            className="floating-next"
            onClick={() => onNavigateToEmails(focus.entryId!)}
            title={t.goToEmailGenerator}
          >
            <span className="floating-next-step">3</span>
            <span className="floating-next-text">
              <span className="floating-next-hint">{t.nextStep}</span>
              <span>{t.emailGenerator}</span>
            </span>
            <span className="floating-next-arrow">→</span>
          </button>
        )}

        {editingPlan && (
          <PlanEditorModal
            editing={editingPlan}
            products={products}
            setEditing={setEditingPlan}
            onCancel={closePlanModal}
            onSave={savePlan}
            readOnly={planModalReadOnly}
            onEnterEdit={() => setPlanModalReadOnly(false)}
          />
        )}

        {groupPickerTarget && (
          <SupplierPickerModal
            suppliers={suppliers}
            currentSupplierId={groupPickerTarget.supplierId}
            typeFilter={groupTypeFilter(groupPickerTarget)}
            onCancel={() => setGroupPickerTarget(null)}
            onPick={(id) => reassignGroup(groupPickerTarget, id)}
          />
        )}
      </div>
    );
  }

  // ----- List view (default) -----
  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.shortageReport}</h1>
        {history.length > 0 && (
          <span className="page-header-count">{history.length}</span>
        )}
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
      {taskBanner}

      {!hasPlans ? (
        <NoPlansEmptyState onAddPlan={() => onNavigate('productionPlan')} />
      ) : (
        <div className="compute-hero">
          <span className="compute-hero-icon" aria-hidden>
            ⚡
          </span>
          <div className="compute-hero-text">
            <span className="compute-hero-title">{t.computeShortages}</span>
            <span className="compute-hero-hint">{t.dashboardMissingItems}</span>
            <div className="compute-hero-controls">
              <SearchableSelect
                options={plans.map((p) => ({ value: p.id, label: p.name }))}
                value={selectedPlanId}
                onChange={onSelectPlan}
                placeholder={t.selectPlanFirst}
                footerAction={{
                  label: t.addPlanCta,
                  icon: <IconPlus size={13} />,
                  onClick: openAddPlan,
                }}
              />
              <button
                className="compute-hero-cta"
                onClick={compute}
                disabled={!selectedPlanId || busy}
              >
                {busy ? t.loading : t.computeShortages} →
              </button>
            </div>
            {error && <div className="compute-hero-error">{error}</div>}
          </div>
        </div>
      )}

      {history.length > 0 && (() => {
        const visibleHistory = history.filter((e) => showArchived || !e.archived);
        return (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">{t.olderReportsTitle}</div>
              <div className="hint">{t.olderReportsHint}</div>
            </div>
            <button
              className="btn btn-sm soft-danger"
              onClick={() => setConfirmDeleteAll(true)}
              disabled={busy}
              title={t.deleteAll}
            >
              <IconTrash size={13} /> {t.deleteAll}
            </button>
          </div>
          {info && <div className="hint" style={{ marginBottom: 8 }}>{info}</div>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.reportName}</th>
                  <th>{t.selectedPlan}</th>
                  <th>{t.orders}</th>
                  <th>{t.computedAtLabel}</th>
                  <th>{t.shortageReport}</th>
                  <th className="actions actions-sticky">{t.actionsHeader}</th>
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((e) => {
                  const linkedPlan = plans.find((p) => p.id === e.planId);
                  const livePlanName = linkedPlan?.name ?? e.planName;
                  const planMissing = dataLoaded && !!e.planId && !linkedPlan;
                  const linkedOrder = e.orderId
                    ? orders.find((o) => o.id === e.orderId)
                    : null;
                  const orderStatusLabel = linkedOrder
                    ? linkedOrder.status === 'draft'
                      ? t.orderStatusDraft
                      : linkedOrder.status === 'in_progress'
                        ? t.orderStatusInProgress
                        : linkedOrder.status === 'completed'
                          ? t.orderStatusCompleted
                          : t.orderStatusCancelled
                    : null;
                  return (
                  <tr
                    key={e.id}
                    className={`row-clickable${e.archived ? ' row-archived' : ''}`}
                    onClick={() => openEntry(e, 'preview')}
                    title={t.preview}
                  >
                    <td className="col-name col-wrap">
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>{e.reportName}</span>
                        {e.archived && (
                          <span className="tag" title={t.archivedTag}>
                            {t.archivedTag}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="col-wrap">
                      <div className="cell-with-end-tag">
                        {planMissing && (
                          <span
                            className="tag danger"
                            title={t.linkedPlanDeleted}
                          >
                            {t.linkedPlanDeletedTag}
                          </span>
                        )}
                        <button
                          type="button"
                          className="link-button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openPlanModal(e.planId);
                          }}
                          title={planMissing ? t.linkedPlanDeleted : t.openPlan}
                          disabled={planMissing}
                        >
                          {livePlanName}
                        </button>
                      </div>
                    </td>
                    <td className="col-wrap" onClick={(ev) => ev.stopPropagation()}>
                      {linkedOrder ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => onNavigateToOrder?.(linkedOrder.id)}
                            title={t.orderDetails}
                          >
                            {linkedOrder.name}
                          </button>
                          <span
                            className={`badge order-status-${linkedOrder.status}`}
                            title={`${t.orderStatus}: ${orderStatusLabel}`}
                          >
                            {orderStatusLabel}
                          </span>
                        </div>
                      ) : dataLoaded && e.orderId ? (
                        <span className="tag danger" title={t.orderDeleted}>
                          {t.orderDeletedTag}
                        </span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                    <td className="hint">{new Date(e.computedAt).toLocaleString()}</td>
                    <td>
                      <ShortageReportTooltip entry={e} batches={batches} />
                    </td>
                    <td
                      className="actions actions-sticky"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div className="btn-row">
                        {e.orderId ? (
                          <button
                            className="btn btn-sm soft-danger"
                            onClick={() => void setReportOrder(e.id, null)}
                            title={t.unlinkOrder}
                          >
                            <IconClose size={13} /> {t.unlinkOrder}
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm soft-success"
                            onClick={() => {
                              if (orderTaskContextOrderId) {
                                void setReportOrder(e.id, orderTaskContextOrderId);
                              } else {
                                setPickerEntryId(e.id);
                              }
                            }}
                            disabled={orders.length === 0}
                            title={t.linkOrder}
                          >
                            <IconPlus size={13} /> {t.linkOrder}
                          </button>
                        )}
                        <button
                          className="btn btn-sm soft-edit"
                          onClick={() => openEntry(e, 'edit')}
                          title={t.edit}
                        >
                          <IconEdit size={13} /> {t.edit}
                        </button>
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={() => setConfirmDelete(e)}
                          title={t.delete}
                        >
                          <IconTrash size={13} /> {t.delete}
                        </button>
                        <button
                          className="btn btn-sm soft-success"
                          onClick={() => onNavigateToEmails(e.id)}
                          disabled={e.report.groups.length === 0}
                          title={t.generateEmails}
                        >
                          <IconMail size={13} /> {t.generateEmails}
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
        );
      })()}

      {confirmDelete && (
        <ConfirmDialog
          message={`${t.deleteReportConfirm}: ${confirmDelete.reportName} (${new Date(
            confirmDelete.computedAt,
          ).toLocaleString()})?`}
          onConfirm={onConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}

      {confirmDeleteAll && (
        <ConfirmDialog
          message={t.deleteAllConfirm.replace('{n}', String(history.length))}
          onConfirm={onConfirmDeleteAll}
          onCancel={() => setConfirmDeleteAll(false)}
          danger
        />
      )}

      {editingPlan && (
        <PlanEditorModal
          editing={editingPlan}
          products={products}
          setEditing={setEditingPlan}
          onCancel={closePlanModal}
          onSave={savePlan}
          readOnly={planModalReadOnly}
          onEnterEdit={() => setPlanModalReadOnly(false)}
        />
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
              {(() => {
                const archivedCount = history.filter((e) => e.archived).length;
                return (
                  <label className="settings-toggle-row">
                    <span>
                      {t.showArchived}
                      {archivedCount > 0 && (
                        <span className="hint" style={{ marginLeft: 6 }}>
                          ({archivedCount})
                        </span>
                      )}
                    </span>
                    <input
                      type="checkbox"
                      checked={showArchived}
                      onChange={(ev) => setShowArchived(ev.target.checked)}
                    />
                  </label>
                );
              })()}
            </div>
            <div className="modal-footer">
              <button
                className="btn primary-filled"
                onClick={() => setSettingsOpen(false)}
              >
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {(() => {
        const nextEntry = history.find((e) => e.report.groups.length > 0);
        if (!nextEntry) return null;
        return (
          <button
            className="floating-next"
            onClick={() => onNavigateToEmails(nextEntry.id)}
            title={t.goToEmailGenerator}
          >
            <span className="floating-next-step">3</span>
            <span className="floating-next-text">
              <span className="floating-next-hint">{t.nextStep}</span>
              <span>{t.emailGenerator}</span>
            </span>
            <span className="floating-next-arrow">→</span>
          </button>
        );
      })()}

      {pickerEntryId && (
        <ReportOrderPicker
          orders={orders.filter((o) => o.status !== 'completed' && o.status !== 'cancelled')}
          onCancel={() => setPickerEntryId(null)}
          onPick={(orderId) => void setReportOrder(pickerEntryId, orderId)}
        />
      )}

      {pendingExpired && (
        <ExpiredStockModal
          batches={pendingExpired.batches}
          onCancel={() => setPendingExpired(null)}
          onConfirm={(ids) => {
            const planId = pendingExpired.planId;
            setPendingExpired(null);
            setExpiredIncludeIds(ids);
            void gateDependencyShortages(planId, ids);
          }}
        />
      )}

      {pendingDeps && (
        <DependencyShortageModal
          rows={pendingDeps.refs.map((r) => ({
            componentId: r.componentId,
            name: r.componentName,
            consumedBy: r.consumedBy,
            detail: t.depShortageDetailReport
              .replace('{required}', (r.required ?? 0).toLocaleString())
              .replace('{available}', r.available.toLocaleString())
              .replace('{shortage}', (r.shortage ?? 0).toLocaleString()),
            candidates: buildSubstituteCandidates(components, r.componentId),
          }))}
          onCancel={() => setPendingDeps(null)}
          onConfirm={({ acceptedIds, substitutions }) => {
            const { planId, expiredIds } = pendingDeps;
            setPendingDeps(null);
            setAcceptedDepIds(acceptedIds);
            setDepSubstitutions(substitutions);
            void runCompute(planId, expiredIds, acceptedIds, substitutions);
          }}
        />
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

// Small modal for picking which order to link the focused report to.
const ReportOrderPicker: React.FC<{
  orders: Order[];
  onCancel: () => void;
  onPick: (orderId: string) => void;
}> = ({ orders, onCancel, onPick }) => {
  const t = useT();
  useEscapeKey(onCancel);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconPlus size={18} />}
          tone="add"
          title={t.linkOrder}
          onClose={onCancel}
        />
        <div className="modal-body picker-list">
          {orders.length === 0 ? (
            <p className="empty-hint">{t.ordersEmpty}</p>
          ) : (
            orders.map((o) => (
              <button
                key={o.id}
                type="button"
                className="picker-item"
                onClick={() => onPick(o.id)}
              >
                <span className="picker-item-label">{o.name}</span>
                <span className="picker-item-sub">{o.startDate}</span>
              </button>
            ))
          )}
        </div>
        <div className="picker-footer">
          <button type="button" className="btn" onClick={onCancel}>
            <IconClose size={12} /> {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShortageReportView;
