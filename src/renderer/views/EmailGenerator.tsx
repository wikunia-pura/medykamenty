import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav, useNavigation } from '../navigation';
import type {
  EmailBatch,
  Lang,
  Product,
  ProductionPlan,
  RFQEmailRecord,
  ShortageReportEntry,
} from '../../shared/types';
import type { ViewKey } from './types';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import HoverTooltip from '../components/HoverTooltip';
import PlanEditorModal from '../components/PlanEditorModal';
import {
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconEye,
  IconMail,
  IconPlus,
  IconTrash,
} from '../components/Icons';

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
}

interface FocusState {
  batch: EmailBatch;
  originFromNav?: boolean;
}

const cache: { focus: FocusState | null } = { focus: null };

export const resetEmailGeneratorFocus = () => {
  cache.focus = null;
};

const formatReportLabel = (e: ShortageReportEntry): string => {
  const groups = e.report.groups.length;
  const suffix = groups === 0 ? ' — brak braków' : ` — ${groups}`;
  return `${e.reportName}${suffix}`;
};

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
}) => {
  const t = useT();
  const navCtx = useNavigation();
  const [reports, setReports] = useState<ShortageReportEntry[]>([]);
  const [batches, setBatches] = useState<EmailBatch[]>([]);
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [focus, setFocus] = useState<FocusState | null>(cache.focus);
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [listQuery, setListQuery] = useState('');
  const [focusQuery, setFocusQuery] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<EmailBatch | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingPlan, setEditingPlan] = useState<Partial<ProductionPlan> | null>(null);
  const [planModalReadOnly, setPlanModalReadOnly] = useState(false);

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
    const [reportsRes, batchesRes, plansRes, productsRes] = await Promise.allSettled([
      window.electronAPI.listShortageReports(),
      window.electronAPI.listEmailBatches(),
      window.electronAPI.listPlans(),
      window.electronAPI.listProducts(),
    ]);
    const r = reportsRes.status === 'fulfilled' ? reportsRes.value : [];
    const b = batchesRes.status === 'fulfilled' ? batchesRes.value : [];
    const p = plansRes.status === 'fulfilled' ? plansRes.value : [];
    const pr = productsRes.status === 'fulfilled' ? productsRes.value : [];
    if (reportsRes.status === 'rejected') {
      console.error('listShortageReports failed', reportsRes.reason);
      setError((reportsRes.reason as Error)?.message ?? 'Failed to load reports');
    } else if (batchesRes.status === 'rejected') {
      console.error('listEmailBatches failed', batchesRes.reason);
      setError((batchesRes.reason as Error)?.message ?? 'Failed to load batches');
    }
    setReports(r);
    setBatches(b);
    setPlans(p);
    setProducts(pr);
    return { reports: r, batches: b };
  };

  useEffect(() => {
    void (async () => {
      setLoaderMessage(t.loading);
      try {
        const { reports: r } = await loadAll();
        const firstWithGroups = r.find((x) => x.report.groups.length > 0);
        if (!selectedReportId && firstWithGroups) onSelectReport(firstWithGroups.id);
      } finally {
        setLoaderMessage(null);
      }
    })();
  }, []);

  const selectedReport = useMemo(
    () => reports.find((r) => r.id === selectedReportId),
    [reports, selectedReportId],
  );

  const generate = async (reportId: string) => {
    if (!reportId) return;
    setBusy(true);
    setLoaderMessage(t.loaderGenerating);
    setError(null);
    try {
      const batch = await window.electronAPI.generateEmails(reportId, {
        language: defaultLanguage,
        useAI: useAiByDefault && aiAvailable,
      });
      await loadAll();
      setFocusAndCache({ batch });
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

  // Auto-generate when navigated here from a shortage report.
  useEffect(() => {
    if (!autoGenerate || !selectedReportId) return;
    onAutoGenerateConsumed?.();
    void generate(selectedReportId);
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

  const refreshFocus = async (batchId: string) => {
    const fresh = await window.electronAPI.getEmailBatch(batchId);
    if (fresh) setFocusAndCache({ batch: fresh, originFromNav: focus?.originFromNav });
    await loadAll();
  };

  const toggleSent = async (
    batchId: string,
    emailId: string,
    currentSentAt?: string,
  ) => {
    const next = currentSentAt ? null : new Date().toISOString();
    await window.electronAPI.markEmailSent(batchId, emailId, next);
    await refreshFocus(batchId);
  };

  const updateBody = async (batchId: string, emailId: string, body: string) => {
    if (!focus) return;
    const updatedEmails = focus.batch.emails.map((e) =>
      e.id === emailId ? { ...e, body } : e,
    );
    setFocusAndCache({
      batch: { ...focus.batch, emails: updatedEmails },
      originFromNav: focus.originFromNav,
    });
    await window.electronAPI.updateBatchEmail(batchId, emailId, { body });
  };

  const changeEmailLanguage = async (
    batchId: string,
    emailId: string,
    nextLang: Lang,
  ) => {
    const key = `${batchId}:${emailId}`;
    setRegenKey(key);
    setError(null);
    try {
      const updated = await window.electronAPI.regenerateBatchEmail(
        batchId,
        emailId,
        { language: nextLang, useAI: useAiByDefault && aiAvailable },
      );
      setFocusAndCache({ batch: updated, originFromNav: focus?.originFromNav });
      await loadAll();
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

  const mailtoHref = (e: RFQEmailRecord) =>
    `mailto:${encodeURIComponent(e.to)}?subject=${encodeURIComponent(
      e.subject,
    )}&body=${encodeURIComponent(e.body)}`;

  const onConfirmDeleteBatch = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    await window.electronAPI.deleteEmailBatch(id);
    if (focus?.batch.id === id) setFocusAndCache(null);
    await loadAll();
  };

  const onConfirmDeleteAll = async () => {
    setConfirmDeleteAll(false);
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.deleteAllInProgress);
    const total = batches.length;
    try {
      for (const b of batches) {
        await window.electronAPI.deleteEmailBatch(b.id);
      }
      setInfo(t.deleteAllSuccess.replace('{n}', String(total)));
      setFocusAndCache(null);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
      await loadAll();
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  // ----- Focus view: a single batch -----
  if (focus) {
    const { batch } = focus;
    const sentCount = batch.emails.filter((e) => !!e.sentAt).length;
    const filteredEmails = !focusQuery.trim()
      ? batch.emails
      : batch.emails.filter((e) => matchesQuery(e, focusQuery));
    const linkedPlan = batch.planId ? plans.find((p) => p.id === batch.planId) : undefined;
    const planMissing = !!batch.planId && !linkedPlan;
    const livePlanName = linkedPlan?.name ?? batch.planName;
    const linkedReport = batch.reportId
      ? reports.find((r) => r.id === batch.reportId)
      : undefined;
    const reportMissing = !!batch.reportId && !linkedReport;
    return (
      <div className="main">
        <div className="focus-bar">
          <button
            className="btn"
            onClick={handleBack}
            title={t.backToList}
          >
            <IconArrowLeft size={14} /> {t.backToList}
          </button>
          <div className="focus-bar-text">
            <h1 className="focus-bar-title">
              {t.emailBatchTitle}
            </h1>
            <span className="focus-bar-meta">
              <span className="hint">{t.reportName}:</span>{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => onNavigateToReport?.(batch.planId, batch.reportId)}
                title={reportMissing ? t.linkedReportDeleted : t.goToShortageReport}
                disabled={!onNavigateToReport || reportMissing}
              >
                {batch.reportName}
              </button>
              {reportMissing && (
                <span
                  className="tag danger"
                  style={{ marginLeft: 6 }}
                  title={t.linkedReportDeleted}
                >
                  {t.linkedReportDeletedTag}
                </span>
              )}
            </span>
            <span className="focus-bar-meta">
              <span className="hint">{t.selectedPlan}:</span>{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => openPlanModal(batch.planId)}
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
            <span className="tag">
              {sentCount}/{batch.emails.length} {t.sentCount}
            </span>
          </div>
        </div>

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
                    <span
                      className="tag success"
                      title={new Date(e.sentAt!).toLocaleString()}
                    >
                      <IconCheck size={11} /> {t.sentBadge}
                    </span>
                  )}
                </div>
                <div className="btn-row">
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
                    title={t.preferredEmailLanguage}
                  >
                    <option value="pl">PL</option>
                    <option value="en">EN</option>
                  </select>
                  <button
                    className={`btn btn-sm ${
                      copiedKey === key ? 'soft-success' : 'soft-edit'
                    }`}
                    onClick={() => copy(key, e.body)}
                    title={t.copy}
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
                      href={mailtoHref(e)}
                      title={t.openInMailClient}
                    >
                      <IconMail size={13} /> {t.openInMailClient}
                    </a>
                  )}
                  <button
                    className={`btn btn-sm ${isSent ? 'soft-danger' : 'soft-success'}`}
                    onClick={() => toggleSent(batch.id, e.id, e.sentAt)}
                    title={isSent ? t.unmarkSent : t.markSent}
                  >
                    <IconCheck size={13} /> {isSent ? t.unmarkSent : t.markSent}
                  </button>
                </div>
              </div>
              <div className="form-row">
                <label>Subject</label>
                <input className="input" readOnly value={e.subject} />
              </div>
              <textarea
                value={e.body}
                onChange={(ev) => updateBody(batch.id, e.id, ev.target.value)}
                rows={Math.min(20, Math.max(8, e.body.split('\n').length + 1))}
                disabled={isRegen}
              />
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
      </div>
    );
  }

  // ----- List view (default) -----
  const reportOptions = reports.map((e) => ({
    value: e.id,
    label: formatReportLabel(e),
  }));

  const selectedHasNoGroups =
    !!selectedReport && selectedReport.report.groups.length === 0;

  const filteredBatches = !listQuery.trim()
    ? batches
    : batches.filter((b) => matchesQuery(b, listQuery));

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.emailGenerator}</h1>
        {batches.length > 0 && (
          <span className="page-header-count">{batches.length}</span>
        )}
      </div>

      {reports.length === 0 ? (
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
          <span className="compute-hero-icon" aria-hidden>
            ✉️
          </span>
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
                onClick={() => generate(selectedReportId)}
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

      {batches.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">{t.olderEmailBatchesTitle}</div>
              <div className="hint">{t.olderEmailBatchesHint}</div>
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
                    <th>{t.reportName}</th>
                    <th>{t.selectedPlan}</th>
                    <th>{t.generatedAtLabel}</th>
                    <th>{t.suppliers}</th>
                    <th className="actions actions-sticky">{t.actionsHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBatches.map((b) => {
                    const sent = b.emails.filter((e) => !!e.sentAt).length;
                    const total = b.emails.length;
                    const allSent = total > 0 && sent === total;
                    const rowLinkedPlan = plans.find((p) => p.id === b.planId);
                    const livePlanName = rowLinkedPlan?.name ?? b.planName;
                    const rowPlanMissing = !!b.planId && !rowLinkedPlan;
                    const rowReportMissing =
                      !!b.reportId && !reports.some((r) => r.id === b.reportId);
                    return (
                      <tr
                        key={b.id}
                        className="row-clickable"
                        onClick={() => setFocusAndCache({ batch: b })}
                        title={t.preview}
                      >
                        <td className="col-name col-wrap">
                          <div className="cell-with-end-tag">
                            {rowReportMissing && (
                              <span
                                className="tag danger"
                                title={t.linkedReportDeleted}
                              >
                                {t.linkedReportDeletedTag}
                              </span>
                            )}
                            {onNavigateToReport ? (
                              <button
                                type="button"
                                className="link-button"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  onNavigateToReport(b.planId, b.reportId);
                                }}
                                title={
                                  rowReportMissing
                                    ? t.linkedReportDeleted
                                    : t.goToShortageReport
                                }
                                disabled={rowReportMissing}
                              >
                                {b.reportName}
                              </button>
                            ) : (
                              <span>{b.reportName}</span>
                            )}
                          </div>
                        </td>
                        <td className="col-wrap">
                          <div className="cell-with-end-tag">
                            {rowPlanMissing && (
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
                                openPlanModal(b.planId);
                              }}
                              title={rowPlanMissing ? t.linkedPlanDeleted : t.openPlan}
                              disabled={rowPlanMissing}
                            >
                              {livePlanName}
                            </button>
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
                            <button
                              className="btn btn-sm"
                              onClick={() => setFocusAndCache({ batch: b })}
                              title={t.preview}
                            >
                              <IconEye size={13} /> {t.preview}
                            </button>
                            <button
                              className="btn btn-sm soft-danger"
                              onClick={() => setConfirmDelete(b)}
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
          message={t.deleteAllConfirm.replace('{n}', String(batches.length))}
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

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

export default EmailGenerator;
