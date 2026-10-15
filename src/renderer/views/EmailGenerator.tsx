import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import type { T } from '../translations';
import { VIEW_ICONS } from '../viewIcons';
import { HeaderNav, useNavigation } from '../navigation';
import type {
  EmailBatch,
  Lang,
  Product,
  ProductionPlan,
  RFQEmailRecord,
  ShortageReportEntry,
  Supplier,
} from '../../shared/types';
import type { ViewKey } from './types';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import { SkeletonTable } from '../components/SkeletonRows';
import { useMinimumLoading } from '../utils/useMinimumLoading';
import HoverTooltip from '../components/HoverTooltip';
import PlanEditorModal from '../components/PlanEditorModal';
import SupplierPickerModal from '../components/SupplierPickerModal';
import ExistingBatchChooser from '../components/ExistingBatchChooser';
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconEdit,
  IconEye,
  IconMail,
  IconPlus,
  IconSettings,
  IconTrash,
} from '../components/Icons';
import Toggle from '../components/Toggle';
import IconButton from '../components/IconButton';
import ModalHeader from '../components/ModalHeader';

interface Props {
  defaultLanguage: Lang;
  aiAvailable: boolean;
  useAiByDefault: boolean;
  selectedReportId: string;
  onSelectReport: (id: string) => void;
  autoGenerate?: boolean;
  onAutoGenerateConsumed?: () => void;
  onNavigate?: (key: ViewKey) => void;
  onNavigateToReport?: (planId: string, reportId: string) => void;
  focusBatchId?: string;
  onFocusBatchConsumed?: () => void;
  taskBanner?: React.ReactNode;
}

interface FocusState {
  batch: EmailBatch;
  originFromNav?: boolean;
}

const cache: { focus: FocusState | null } = { focus: null };

export const resetEmailGeneratorFocus = () => {
  cache.focus = null;
};

const formatReportLabel = (e: ShortageReportEntry, t: T): string => {
  const groups = e.report.groups.length;
  const suffix = groups === 0 ? ` — ${t.reportLabelNoShortages}` : ` — ${groups}`;
  return `${e.reportName}${suffix}`;
};

// Typing in an email body is saved this long after the last keystroke (and
// immediately on blur), not on every keystroke.
const BODY_SAVE_DEBOUNCE_MS = 800;

const EmailGenerator: React.FC<Props> = ({
  defaultLanguage,
  aiAvailable,
  useAiByDefault,
  selectedReportId,
  onSelectReport,
  autoGenerate,
  onAutoGenerateConsumed,
  onNavigate,
  onNavigateToReport,
  focusBatchId,
  onFocusBatchConsumed,
  taskBanner,
}) => {
  const t = useT();
  const navCtx = useNavigation();
  const [reports, setReports] = useState<ShortageReportEntry[]>([]);
  const [batches, setBatches] = useState<EmailBatch[]>([]);
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  // Becomes true after the first loadAll resolves. Used to suppress the
  // "linked plan / report deleted" warning during the initial render, when
  // those lists are still empty and every linked id falsely looks missing.
  const [dataLoaded, setDataLoaded] = useState(false);
  const [focus, setFocus] = useState<FocusState | null>(cache.focus);
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  // First load: skeleton list instead of a blocking overlay.
  const [initialLoading, setInitialLoading] = useState(true);
  const showSkeleton = useMinimumLoading(initialLoading);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [listQuery, setListQuery] = useState('');
  const [focusQuery, setFocusQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<EmailBatch | null>(null);
  // Ids of the batches the "delete all" confirm will remove — the rows visible
  // when it was opened, never the hidden (archived / filtered-out) ones.
  const [confirmDeleteAll, setConfirmDeleteAll] = useState<string[] | null>(null);
  // Unsaved email-body edits, keyed `${batchId}:${emailId}`. They overlay the
  // stored body, so replacing the batch (e.g. after "mark sent") never wipes
  // what is being typed. Mirrored in a ref for the async save loop.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef<Record<string, string>>({});
  const [bodySaveState, setBodySaveState] = useState<
    Record<string, { saving?: boolean; error?: string }>
  >({});
  const bodySaveTimers = useRef(
    new Map<string, { timer: number; batchId: string; emailId: string }>(),
  );
  const bodySaveRuns = useRef(new Map<string, Promise<void>>());
  // Emails whose "mark sent" toggle is in flight — a double click must not
  // mark and immediately unmark.
  const sentBusyRef = useRef(new Set<string>());
  const [sentBusyKeys, setSentBusyKeys] = useState<Set<string>>(new Set());
  const [showArchived, setShowArchived] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Email whose supplier the user is changing via the modal. null = closed.
  const [supplierPickerTarget, setSupplierPickerTarget] = useState<RFQEmailRecord | null>(
    null,
  );
  const [editingPlan, setEditingPlan] = useState<Partial<ProductionPlan> | null>(null);
  const [planModalReadOnly, setPlanModalReadOnly] = useState(false);
  const [batchNameDraft, setBatchNameDraft] = useState<string | null>(null);
  // When the user asks to generate emails for a report that already has one or
  // more batches, this holds the matches so we can show the chooser modal.
  const [existingChooser, setExistingChooser] = useState<{
    reportId: string;
    batches: EmailBatch[];
  } | null>(null);

  const openPlanModal = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    setEditingPlan({ ...plan });
    setPlanModalReadOnly(true);
  };

  const closePlanModal = () => {
    setEditingPlan(null);
    setPlanModalReadOnly(false);
  };

  const savePlan = async () => {
    if (!editingPlan?.id || !editingPlan.name?.trim()) return;
    await window.electronAPI.updatePlan(editingPlan.id, {
      name: editingPlan.name.trim(),
      items: editingPlan.items ?? [],
      bulkMass: editingPlan.bulkMass ?? [],
      status: editingPlan.status ?? 'draft',
    });
    closePlanModal();
    await loadAll();
  };

  const setFocusAndCache = (next: FocusState | null) => {
    setFocus(next);
    cache.focus = next;
  };

  const loadAll = async (): Promise<{
    reports: ShortageReportEntry[];
    batches: EmailBatch[];
  }> => {
    const [reportsRes, batchesRes, plansRes, productsRes, suppliersRes] =
      await Promise.allSettled([
        window.electronAPI.listShortageReports(),
        window.electronAPI.listEmailBatches(),
        window.electronAPI.listPlans(),
        window.electronAPI.listProducts(),
        window.electronAPI.listSuppliers(),
      ]);
    const r = reportsRes.status === 'fulfilled' ? reportsRes.value : [];
    const b = batchesRes.status === 'fulfilled' ? batchesRes.value : [];
    const p = plansRes.status === 'fulfilled' ? plansRes.value : [];
    const pr = productsRes.status === 'fulfilled' ? productsRes.value : [];
    const su = suppliersRes.status === 'fulfilled' ? suppliersRes.value : [];
    if (reportsRes.status === 'rejected') {
      console.error('listShortageReports failed', reportsRes.reason);
      setError((reportsRes.reason as Error)?.message ?? t.loadReportsFailed);
    } else if (batchesRes.status === 'rejected') {
      console.error('listEmailBatches failed', batchesRes.reason);
      setError((batchesRes.reason as Error)?.message ?? t.loadEmailBatchesFailed);
    }
    setReports(r);
    setBatches(b);
    setPlans(p);
    setProducts(pr);
    setSuppliers(su);
    setDataLoaded(true);
    return { reports: r, batches: b };
  };

  useEffect(() => {
    void (async () => {
      setInitialLoading(true);
      try {
        const { reports: r } = await loadAll();
        const firstWithGroups = r.find((x) => x.report.groups.length > 0);
        if (!selectedReportId && firstWithGroups) onSelectReport(firstWithGroups.id);
      } finally {
        setInitialLoading(false);
      }
    })();
  }, []);

  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId),
    [reports, selectedReportId],
  );

  const generate = async (reportId: string, originFromNav = false) => {
    if (!reportId) return;
    setBusy(true);
    setLoaderMessage(t.loaderGenerating);
    setError(null);
    try {
      const batch = await window.electronAPI.generateEmails(reportId, {
        language: defaultLanguage,
        useAI: useAiByDefault && aiAvailable,
      });
      setBatches((prev) => [batch, ...prev.filter((b) => b.id !== batch.id)]);
      setFocusAndCache({ batch, originFromNav });
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  // Entry point for "generate" actions: if the report already has email
  // batches, open the chooser so the user can either jump to an existing
  // batch or explicitly opt into creating a new one. Otherwise generate
  // straight away (current behavior).
  const requestGenerate = (reportId: string) => {
    if (!reportId) return;
    const existing = batches
      .filter((b) => b.reportId === reportId)
      .sort(
        (a, b) =>
          new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime(),
      );
    if (existing.length > 0) {
      setExistingChooser({ reportId, batches: existing });
      return;
    }
    void generate(reportId);
  };

  // Auto-generate when navigated here from a shortage report. The caller
  // (App.tsx) has already checked for existing batches and shown the chooser
  // upstream, so here we just generate. The ref guard is required because
  // React 18 StrictMode double-invokes effects in dev; without it the second
  // pass would call generate again before the parent's autoGenerate flag
  // flips, producing a duplicate batch.
  const autoGenFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoGenerate || !selectedReportId) return;
    if (autoGenFiredRef.current === selectedReportId) return;
    autoGenFiredRef.current = selectedReportId;
    onAutoGenerateConsumed?.();
    // autoGenerate is only set by external callers (App helpers), so the
    // resulting focus view's Back button should pop the nav stack, not just
    // unfocus into the local batch list.
    void generate(selectedReportId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, selectedReportId]);

  // Focus a specific email batch when navigated here from another view.
  useEffect(() => {
    if (!focusBatchId) return;
    const batch = batches.find((b) => b.id === focusBatchId);
    if (batch) {
      setFocusAndCache({ batch, originFromNav: true });
      onFocusBatchConsumed?.();
      if (typeof window !== 'undefined') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [focusBatchId, batches]);

  const handleBack = () => {
    if (focus?.originFromNav && navCtx?.canGoBack) {
      navCtx.goBack();
    } else {
      setFocusAndCache(null);
    }
  };

  // Write fields of one batch / one email into the local copies (the batch
  // list and the focused batch) instead of replacing the whole batch with a
  // server copy — a server copy can be older than a body save that finished
  // first, and would put already-typed text back. Reads the module cache so
  // a save that completes after the view unmounted still lands there.
  const patchBatchLocal = (batchId: string, fn: (b: EmailBatch) => EmailBatch) => {
    setBatches((prev) => prev.map((b) => (b.id === batchId ? fn(b) : b)));
    const cur = cache.focus;
    if (cur && cur.batch.id === batchId) setFocusAndCache({ ...cur, batch: fn(cur.batch) });
  };

  const patchEmailLocal = (
    batchId: string,
    emailId: string,
    patch: Partial<RFQEmailRecord>,
  ) =>
    patchBatchLocal(batchId, (b) => ({
      ...b,
      emails: b.emails.map((e) => (e.id === emailId ? { ...e, ...patch } : e)),
    }));

  const commitBatchNameRename = async () => {
    if (!focus || batchNameDraft === null) return;
    const next = batchNameDraft.trim();
    setBatchNameDraft(null);
    if (!next || next === focus.batch.batchName) return;
    try {
      const updated = await window.electronAPI.updateEmailBatch(focus.batch.id, {
        batchName: next,
      });
      if (!updated) throw new Error(t.emailBatchMissing);
      patchBatchLocal(updated.id, (b) => ({ ...b, batchName: updated.batchName }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Reassign the email to a different supplier — updates the recipient on the
  // email record only. The underlying raw materials / components keep their
  // existing supplier links; if the report is recomputed later, the email will
  // be regenerated against the current data.
  const changeEmailSupplier = async (
    batchId: string,
    email: RFQEmailRecord,
    newSupplierId: string,
  ) => {
    if (!newSupplierId) return;
    const next = suppliers.find((s) => s.id === newSupplierId);
    if (!next) return;
    setError(null);
    try {
      const updated = await window.electronAPI.updateBatchEmail(batchId, email.id, {
        supplierId: next.id,
        supplierName: next.name,
        to: next.email ?? '',
      });
      if (!updated) throw new Error(t.emailBatchMissing);
      const fresh = updated.emails.find((e) => e.id === email.id);
      patchEmailLocal(batchId, email.id, {
        supplierId: fresh?.supplierId ?? next.id,
        supplierName: fresh?.supplierName ?? next.name,
        to: fresh?.to ?? next.email ?? '',
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSupplierPickerTarget(null);
    }
  };

  // Pick the picker's type filter from the email's line mix — pure-raw emails
  // get the 'raw' filter, pure-component emails get 'component', mixed (rare)
  // gets no filter.
  const emailSupplierTypeFilter = (
    email: RFQEmailRecord,
  ): 'raw' | 'component' | undefined => {
    const hasRaw = email.lines.some((l) => l.itemKind === 'raw');
    const hasComp = email.lines.some((l) => l.itemKind === 'component');
    if (hasRaw && !hasComp) return 'raw';
    if (hasComp && !hasRaw) return 'component';
    return undefined;
  };

  const toggleSent = async (
    batchId: string,
    emailId: string,
    currentSentAt?: string,
  ) => {
    const key = `${batchId}:${emailId}`;
    if (sentBusyRef.current.has(key)) return;
    sentBusyRef.current.add(key);
    setSentBusyKeys(new Set(sentBusyRef.current));
    setError(null);
    try {
      const next = currentSentAt ? null : new Date().toISOString();
      const updated = await window.electronAPI.markEmailSent(batchId, emailId, next);
      if (!updated) throw new Error(t.emailBatchMissing);
      // Only the sent flag comes from the returned batch — the body may have
      // an unsaved draft or a newer save in flight.
      const fresh = updated.emails.find((e) => e.id === emailId);
      patchEmailLocal(batchId, emailId, { sentAt: fresh?.sentAt });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      sentBusyRef.current.delete(key);
      setSentBusyKeys(new Set(sentBusyRef.current));
    }
  };

  const setDraft = (key: string, text: string | null) => {
    const next = { ...draftsRef.current };
    if (text === null) delete next[key];
    else next[key] = text;
    draftsRef.current = next;
    setDrafts(next);
  };

  const clearBodySaveTimer = (key: string) => {
    const pending = bodySaveTimers.current.get(key);
    if (pending) {
      window.clearTimeout(pending.timer);
      bodySaveTimers.current.delete(key);
    }
  };

  // Saves the email's draft body. One save at a time per email: a call while
  // one is running joins it, and the running loop re-reads the draft when its
  // request returns, so the latest text always wins and nothing is lost.
  const saveBody = (batchId: string, emailId: string): Promise<void> => {
    const key = `${batchId}:${emailId}`;
    clearBodySaveTimer(key);
    const running = bodySaveRuns.current.get(key);
    if (running) return running;
    if (draftsRef.current[key] === undefined) return Promise.resolve();
    const run = (async () => {
      setBodySaveState((prev) => ({ ...prev, [key]: { saving: true } }));
      try {
        for (;;) {
          const text = draftsRef.current[key];
          if (text === undefined) break;
          const updated = await window.electronAPI.updateBatchEmail(batchId, emailId, {
            body: text,
          });
          if (!updated) throw new Error(t.emailBatchMissing);
          patchEmailLocal(batchId, emailId, { body: text });
          if (draftsRef.current[key] === text) {
            setDraft(key, null);
            break;
          }
        }
        setBodySaveState((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      } catch (err) {
        // The draft stays on screen; the next keystroke or blur retries.
        setBodySaveState((prev) => ({
          ...prev,
          [key]: { error: t.emailBodySaveFailed.replace('{error}', (err as Error).message) },
        }));
      } finally {
        bodySaveRuns.current.delete(key);
      }
    })();
    bodySaveRuns.current.set(key, run);
    return run;
  };

  const onBodyChange = (batchId: string, emailId: string, text: string) => {
    const key = `${batchId}:${emailId}`;
    setDraft(key, text);
    // The module cache outlives this view: leaving and coming back before the
    // save lands must show the text as typed, not the last saved one (and
    // further typing must not build on the stale body).
    const cached = cache.focus;
    if (cached?.batch.id === batchId) {
      cache.focus = {
        ...cached,
        batch: {
          ...cached.batch,
          emails: cached.batch.emails.map((e) => (e.id === emailId ? { ...e, body: text } : e)),
        },
      };
    }
    clearBodySaveTimer(key);
    const timer = window.setTimeout(() => {
      bodySaveTimers.current.delete(key);
      void saveBody(batchId, emailId);
    }, BODY_SAVE_DEBOUNCE_MS);
    bodySaveTimers.current.set(key, { timer, batchId, emailId });
  };

  // Leaving the view (sidebar, history nav) skips the textarea's blur — save
  // whatever is still waiting for its debounce.
  useEffect(
    () => () => {
      for (const { batchId, emailId } of Array.from(bodySaveTimers.current.values())) {
        void saveBody(batchId, emailId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const changeEmailLanguage = async (
    batchId: string,
    emailId: string,
    nextLang: Lang,
  ) => {
    const key = `${batchId}:${emailId}`;
    setRegenKey(key);
    setError(null);
    try {
      // Regenerating replaces the body: drop the draft and let a save that is
      // already on its way finish first, so it cannot overwrite the new text.
      clearBodySaveTimer(key);
      setDraft(key, null);
      await bodySaveRuns.current.get(key);
      setBodySaveState((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      const updated = await window.electronAPI.regenerateBatchEmail(
        batchId,
        emailId,
        { language: nextLang, useAI: useAiByDefault && aiAvailable },
      );
      const fresh = updated.emails.find((e) => e.id === emailId);
      if (fresh) patchEmailLocal(batchId, emailId, fresh);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRegenKey(null);
    }
  };

  const copy = async (key: string, body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
    } catch {
      setError(t.copyFailed);
    }
  };

  const mailtoHref = (e: RFQEmailRecord, body: string) =>
    `mailto:${encodeURIComponent(e.to)}?subject=${encodeURIComponent(
      e.subject,
    )}&body=${encodeURIComponent(body)}`;

  const onConfirmDeleteBatch = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    setError(null);
    try {
      await window.electronAPI.deleteEmailBatch(id);
      setBatches((prev) => prev.filter((b) => b.id !== id));
      if (cache.focus?.batch.id === id) setFocusAndCache(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onConfirmDeleteAll = async () => {
    const ids = confirmDeleteAll ?? [];
    setConfirmDeleteAll(null);
    if (ids.length === 0) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.deleteAllInProgress);
    try {
      const { deleted } = await window.electronAPI.deleteEmailBatches(ids);
      const gone = new Set(ids);
      setBatches((prev) => prev.filter((b) => !gone.has(b.id)));
      if (cache.focus && gone.has(cache.focus.batch.id)) setFocusAndCache(null);
      setInfo(t.deleteAllSuccess.replace('{n}', String(deleted)));
    } catch (err) {
      setError((err as Error).message);
      await loadAll();
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const openExistingBatch = (batch: EmailBatch) => {
    setExistingChooser(null);
    setFocusAndCache({ batch });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const generateFromChooser = () => {
    if (!existingChooser) return;
    const reportId = existingChooser.reportId;
    setExistingChooser(null);
    void generate(reportId);
  };

  const chooserElement = existingChooser ? (
    <ExistingBatchChooser
      batches={existingChooser.batches}
      onOpen={openExistingBatch}
      onCreateNew={generateFromChooser}
      onCancel={() => setExistingChooser(null)}
    />
  ) : null;

  // ----- Focus view: a single batch -----
  if (focus) {
    const { batch } = focus;
    const sentCount = batch.emails.filter((e) => !!e.sentAt).length;
    const filteredEmails = !focusQuery.trim()
      ? batch.emails
      : batch.emails.filter((e) => matchesQuery(e, focusQuery));
    const linkedPlan = batch.planId ? plans.find((p) => p.id === batch.planId) : undefined;
    const planMissing = dataLoaded && !!batch.planId && !linkedPlan;
    const livePlanName = linkedPlan?.name ?? batch.planName;
    const linkedReport = batch.reportId
      ? reports.find((r) => r.id === batch.reportId)
      : undefined;
    const reportMissing = dataLoaded && !!batch.reportId && !linkedReport;
    return (
      <div className="main">
        <div className="focus-bar">
          <button className="btn" onClick={handleBack}>
            <IconArrowLeft size={14} /> {t.backToList}
          </button>
          <div className="focus-bar-text">
            {batchNameDraft !== null ? (
              <input
                autoFocus
                className="focus-bar-title-input"
                value={batchNameDraft}
                onChange={(e) => setBatchNameDraft(e.target.value)}
                onBlur={() => void commitBatchNameRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitBatchNameRename();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setBatchNameDraft(null);
                  }
                }}
              />
            ) : (
              <h1
                className="focus-bar-title focus-bar-title-editable"
                onClick={() =>
                  setBatchNameDraft(batch.batchName || batch.reportName || '')
                }
              >
                {batch.batchName || batch.reportName || t.emailBatchTitle}
                <IconEdit size={13} className="focus-bar-title-pencil" />
              </h1>
            )}
            <span className="focus-bar-meta">
              <span className="hint">{t.reportName}:</span>{' '}
              <HoverTooltip
                className="hover-tooltip-compact"
                trigger={
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => onNavigateToReport?.(batch.planId, batch.reportId)}
                    disabled={!onNavigateToReport || reportMissing}
                  >
                    {batch.reportName}
                  </button>
                }
              >
                {reportMissing ? t.linkedReportDeleted : t.goToShortageReport}
              </HoverTooltip>
              {reportMissing && (
                <span className="tag danger" style={{ marginLeft: 6 }}>
                  {t.linkedReportDeletedTag}
                </span>
              )}
            </span>
            <span className="focus-bar-meta">
              <span className="hint">{t.selectedPlan}:</span>{' '}
              <HoverTooltip
                className="hover-tooltip-compact"
                trigger={
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => openPlanModal(batch.planId)}
                    disabled={planMissing}
                  >
                    {livePlanName}
                  </button>
                }
              >
                {planMissing ? t.linkedPlanDeleted : t.openPlan}
              </HoverTooltip>
              {planMissing && (
                <span className="tag danger" style={{ marginLeft: 6 }}>
                  {t.linkedPlanDeletedTag}
                </span>
              )}
            </span>
            <span className="tag">
              {sentCount}/{batch.emails.length} {t.sentCount}
            </span>
          </div>
        </div>
        {taskBanner}

        {error && <div className="card error-text">{error}</div>}

        {(reportMissing || planMissing) && (
          <div className="card" style={{ borderColor: 'var(--warning)' }}>
            {reportMissing && (
              <div className="warn-text">
                <strong>{t.linkedReportDeleted}</strong>
              </div>
            )}
            {planMissing && (
              <div className="warn-text">
                <strong>{t.linkedPlanDeleted}</strong>
              </div>
            )}
          </div>
        )}

        {batch.emails.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <SearchInput value={focusQuery} onChange={setFocusQuery} block />
          </div>
        )}

        {batch.emails.length === 0 && <div className="card hint">{t.noData}</div>}

        {filteredEmails.map((e) => {
          const key = `${batch.id}:${e.id}`;
          const isSent = !!e.sentAt;
          const isRegen = regenKey === key;
          const body = drafts[key] ?? e.body;
          const saveState = bodySaveState[key];
          const sentBusy = sentBusyKeys.has(key);
          return (
            <div key={e.id} className={`card ${isSent ? 'email-card-sent' : ''}`}>
              <div className="card-header">
                <div className="card-title">
                  {e.supplierName}{' '}
                  {e.to && (
                    <span className="hint" style={{ marginLeft: 8 }}>
                      &lt;{e.to}&gt;
                    </span>
                  )}{' '}
                  {e.refinedByAI && <span className="tag success">AI</span>}
                  {isSent && (
                    <span className="tag success">
                      <IconCheck size={11} /> {t.sentBadge}
                    </span>
                  )}
                </div>
                <div className="btn-row">
                  <button
                    className="btn btn-sm soft-edit"
                    onClick={() => setSupplierPickerTarget(e)}
                    disabled={isRegen}
                  >
                    <IconEdit size={13} />{' '}
                    {e.supplierId ? t.changeSupplier : t.assignSupplier}
                  </button>
                  <HoverTooltip
                    align="right"
                    className="hover-tooltip-compact"
                    triggerClassName="icon-button-trigger"
                    trigger={
                      <select
                        className="input email-lang-select"
                        value={e.language}
                        onChange={(ev) => {
                          const val = ev.target.value as Lang;
                          if (val !== e.language) {
                            void changeEmailLanguage(batch.id, e.id, val);
                          }
                        }}
                        disabled={isRegen}
                        aria-label={t.emailLanguageLabel}
                      >
                        <option value="pl">PL</option>
                        <option value="en">EN</option>
                      </select>
                    }
                  >
                    {t.emailLanguageLabel}
                  </HoverTooltip>
                  <button
                    className={`btn btn-sm ${
                      copiedKey === key ? 'soft-success' : 'soft-edit'
                    }`}
                    onClick={() => copy(key, body)}
                  >
                    {copiedKey === key ? (
                      <IconCheck size={13} />
                    ) : (
                      <IconCopy size={13} />
                    )}{' '}
                    {copiedKey === key ? t.copied : t.copy}
                  </button>
                  {e.to && (
                    <a
                      className="btn btn-sm soft-success"
                      href={mailtoHref(e, body)}
                    >
                      <IconMail size={13} /> {t.openInMailClient}
                    </a>
                  )}
                  <button
                    className={`btn btn-sm ${isSent ? 'soft-danger' : 'soft-success'}`}
                    onClick={() => void toggleSent(batch.id, e.id, e.sentAt)}
                    disabled={sentBusy}
                  >
                    <IconCheck size={13} /> {isSent ? t.unmarkSent : t.markSent}
                  </button>
                </div>
              </div>
              <div className="form-row">
                <label>{t.emailSubject}</label>
                <input className="input" readOnly value={e.subject} />
              </div>
              <textarea
                value={body}
                onChange={(ev) => onBodyChange(batch.id, e.id, ev.target.value)}
                onBlur={() => void saveBody(batch.id, e.id)}
                rows={Math.min(20, Math.max(8, body.split('\n').length + 1))}
                disabled={isRegen}
              />
              {saveState?.error ? (
                <div className="error-text" style={{ marginTop: 6 }}>
                  {saveState.error}
                </div>
              ) : saveState?.saving ? (
                <div className="hint" style={{ marginTop: 6 }}>
                  {t.emailBodySaving}
                </div>
              ) : null}
              {isSent && (
                <div className="hint" style={{ marginTop: 6 }}>
                  {t.sentAtLabel}: {new Date(e.sentAt!).toLocaleString()}
                </div>
              )}
            </div>
          );
        })}

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

        {supplierPickerTarget && (
          <SupplierPickerModal
            suppliers={suppliers}
            currentSupplierId={supplierPickerTarget.supplierId}
            typeFilter={emailSupplierTypeFilter(supplierPickerTarget)}
            onCancel={() => setSupplierPickerTarget(null)}
            onPick={(id) =>
              changeEmailSupplier(batch.id, supplierPickerTarget, id)
            }
          />
        )}

        {chooserElement}
      </div>
    );
  }

  // ----- List view (default) -----
  const reportOptions = reports.map((e) => ({
    value: e.id,
    label: formatReportLabel(e, t),
  }));

  const selectedHasNoGroups =
    !!selectedReport && selectedReport.report.groups.length === 0;

  const visibleBatches = showArchived
    ? batches
    : batches.filter((b) => !b.archived);
  const archivedBatchesCount = batches.filter((b) => b.archived).length;
  const filteredBatches = !listQuery.trim()
    ? visibleBatches
    : visibleBatches.filter((b) => matchesQuery(b, listQuery));

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.emailGenerator}</h1>
        {batches.length > 0 && (
          <span className="page-header-count">{batches.length}</span>
        )}
        <span style={{ marginLeft: 'auto' }}>
          <IconButton
            className="btn-sm"
            icon={<IconSettings size={14} />}
            label={t.settings}
            onClick={() => setSettingsOpen(true)}
          />
        </span>
      </div>
      {taskBanner}

      {reports.length === 0 && !showSkeleton ? (
        <div
          className="card highlight-callout"
          style={{ textAlign: 'center', padding: 32 }}
        >
          <h2 style={{ marginTop: 0 }}>{t.noShortageReportsYet}</h2>
          <p className="hint" style={{ marginBottom: 20 }}>
            {t.emailGeneratorHeroHint}
          </p>
          <button
            className="btn primary-filled"
            onClick={() => onNavigate?.('shortageReport')}
          >
            <IconPlus size={14} /> {t.goToShortageReportToCompute}
          </button>
        </div>
      ) : (
        <div className="compute-hero">
          <span className="compute-hero-icon compute-hero-icon-mail" aria-hidden>{VIEW_ICONS.emailGenerator}</span>
          <div className="compute-hero-text">
            <span className="compute-hero-title">{t.emailGeneratorHeroTitle}</span>
            <span className="compute-hero-hint">{t.emailGeneratorHeroHint}</span>
            <div className="compute-hero-controls">
              <SearchableSelect
                options={reportOptions}
                value={selectedReportId}
                onChange={onSelectReport}
                placeholder={t.selectShortageReportFirst}
              />
              <button
                className="compute-hero-cta"
                onClick={() => requestGenerate(selectedReportId)}
                disabled={!selectedReportId || selectedHasNoGroups || busy}
              >
                {busy ? t.loading : t.generateEmails} →
              </button>
            </div>
            {selectedHasNoGroups && (
              <div className="compute-hero-error">{t.shortageReportNoGroups}</div>
            )}
            {error && <div className="compute-hero-error">{error}</div>}
          </div>
        </div>
      )}

      {showSkeleton && (
        <div className="card card-fill">
          <div className="card-header">
            <div>
              <div className="card-title">{t.olderEmailBatchesTitle}</div>
              <div className="hint">{t.olderEmailBatchesHint}</div>
            </div>
          </div>
          <SkeletonTable
            headers={[t.batchName, t.reportName, t.selectedPlan, t.generatedAtLabel, t.suppliers]}
            actionsHeader={t.actionsHeader}
          />
        </div>
      )}

      {!showSkeleton && batches.length > 0 && (
        <div className="card card-fill">
          <div className="card-header">
            <div>
              <div className="card-title">{t.olderEmailBatchesTitle}</div>
              <div className="hint">{t.olderEmailBatchesHint}</div>
            </div>
            <button
              className="btn btn-sm soft-danger"
              onClick={() => setConfirmDeleteAll(filteredBatches.map((b) => b.id))}
              disabled={busy}
            >
              <IconTrash size={13} /> {t.deleteAll}
            </button>
          </div>
          {info && <div className="hint" style={{ marginBottom: 8 }}>{info}</div>}
          <div style={{ marginBottom: 12 }}>
            <SearchInput value={listQuery} onChange={setListQuery} block />
          </div>
          {filteredBatches.length === 0 ? (
            <div className="hint">—</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.batchName}</th>
                    <th>{t.reportName}</th>
                    <th>{t.selectedPlan}</th>
                    <th>{t.generatedAtLabel}</th>
                    <th>{t.suppliers}</th>
                    <th className="actions actions-sticky">{t.actionsHeader}</th>
                  </tr>
                </thead>
                <tbody className="rows-enter">
                  {filteredBatches.map((b) => {
                    const sent = b.emails.filter((e) => !!e.sentAt).length;
                    const total = b.emails.length;
                    const allSent = total > 0 && sent === total;
                    const rowLinkedPlan = plans.find((p) => p.id === b.planId);
                    const livePlanName = rowLinkedPlan?.name ?? b.planName;
                    const rowPlanMissing = dataLoaded && !!b.planId && !rowLinkedPlan;
                    const rowReportMissing =
                      dataLoaded &&
                      !!b.reportId &&
                      !reports.some((r) => r.id === b.reportId);
                    return (
                      <tr
                        key={b.id}
                        className={`row-clickable${b.archived ? ' row-archived' : ''}`}
                        onClick={() => setFocusAndCache({ batch: b })}
                      >
                        <td className="col-name col-wrap">
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="link-button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setFocusAndCache({ batch: b });
                              }}
                            >
                              {b.batchName || b.reportName}
                            </button>
                            {b.archived && (
                              <span className="tag">
                                {t.archivedTag}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="col-wrap">
                          <div className="cell-with-end-tag">
                            {rowReportMissing && (
                              <HoverTooltip
                                className="hover-tooltip-compact"
                                trigger={
                                  <span className="tag danger">
                                    {t.linkedReportDeletedTag}
                                  </span>
                                }
                              >
                                {t.linkedReportDeleted}
                              </HoverTooltip>
                            )}
                            {onNavigateToReport ? (
                              <HoverTooltip
                                className="hover-tooltip-compact"
                                trigger={
                                  <button
                                    type="button"
                                    className="link-button"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      onNavigateToReport(b.planId, b.reportId);
                                    }}
                                    disabled={rowReportMissing}
                                  >
                                    {b.reportName}
                                  </button>
                                }
                              >
                                {rowReportMissing
                                  ? t.linkedReportDeleted
                                  : t.goToShortageReport}
                              </HoverTooltip>
                            ) : (
                              <span>{b.reportName}</span>
                            )}
                          </div>
                        </td>
                        <td className="col-wrap">
                          <div className="cell-with-end-tag">
                            {rowPlanMissing && (
                              <HoverTooltip
                                className="hover-tooltip-compact"
                                trigger={
                                  <span className="tag danger">
                                    {t.linkedPlanDeletedTag}
                                  </span>
                                }
                              >
                                {t.linkedPlanDeleted}
                              </HoverTooltip>
                            )}
                            <HoverTooltip
                              className="hover-tooltip-compact"
                              trigger={
                                <button
                                  type="button"
                                  className="link-button"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    openPlanModal(b.planId);
                                  }}
                                  disabled={rowPlanMissing}
                                >
                                  {livePlanName}
                                </button>
                              }
                            >
                              {rowPlanMissing ? t.linkedPlanDeleted : t.openPlan}
                            </HoverTooltip>
                          </div>
                        </td>
                        <td className="hint">
                          {new Date(b.generatedAt).toLocaleString()}
                        </td>
                        <td>
                          <HoverTooltip
                            trigger={
                              <span className="email-batch-summary">
                                <span className="count-bubble">{total}</span>
                                <span
                                  className={`tag ${
                                    allSent ? 'success' : sent > 0 ? 'warn' : ''
                                  }`}
                                >
                                  {sent}/{total} {t.sentCount}
                                </span>
                              </span>
                            }
                          >
                            <div className="shortage-tooltip-header">
                              {t.suppliers} — {sent}/{total} {t.sentCount}
                            </div>
                            <ul className="shortage-tooltip-list">
                              {b.emails.map((e) => (
                                <li key={e.id}>
                                  <span className="shortage-tooltip-name">
                                    {e.supplierName}
                                    {e.to && (
                                      <span
                                        className="hint"
                                        style={{ marginLeft: 6 }}
                                      >
                                        &lt;{e.to}&gt;
                                      </span>
                                    )}
                                  </span>
                                  <span className={`tag ${e.sentAt ? 'success' : ''}`}>
                                    {e.sentAt ? (
                                      <>
                                        <IconCheck size={10} /> {t.sentBadge}
                                      </>
                                    ) : (
                                      '—'
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </HoverTooltip>
                        </td>
                        <td
                          className="actions actions-sticky"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <div className="btn-row">
                            <IconButton
                              className="btn-sm soft-danger"
                              icon={<IconTrash size={14} />}
                              label={t.delete}
                              onClick={() => setConfirmDelete(b)}
                            />
                            <button
                              className="btn btn-sm"
                              onClick={() => setFocusAndCache({ batch: b })}
                            >
                              <IconEye size={13} /> {t.preview}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`${t.deleteBatchConfirm}: ${confirmDelete.reportName} (${new Date(
            confirmDelete.generatedAt,
          ).toLocaleString()})?`}
          onConfirm={onConfirmDeleteBatch}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}

      {confirmDeleteAll && (
        <ConfirmDialog
          message={t.deleteAllConfirm.replace('{n}', String(confirmDeleteAll.length))}
          onConfirm={onConfirmDeleteAll}
          onCancel={() => setConfirmDeleteAll(null)}
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

      {chooserElement}

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
              <label className="settings-toggle-row">
                <span>
                  {t.showArchived}
                  {archivedBatchesCount > 0 && (
                    <span className="hint" style={{ marginLeft: 6 }}>
                      ({archivedBatchesCount})
                    </span>
                  )}
                </span>
                <Toggle
                  checked={showArchived}
                  onChange={setShowArchived}
                  ariaLabel={t.showArchived}
                />
              </label>
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

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

export default EmailGenerator;
