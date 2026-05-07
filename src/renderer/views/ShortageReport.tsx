import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  ProductionPlan,
  Product,
  ShortageLine,
  ShortageReport,
  ShortageReportEntry,
  Supplier,
} from '../../shared/types';
import type { ViewKey } from './types';
import ConfirmDialog from '../components/ConfirmDialog';
import NoPlansEmptyState from '../components/NoPlansEmptyState';
import { IconMail, IconPlus, IconTrash, IconEdit, IconEye, IconArrowLeft } from '../components/Icons';
import SearchableSelect from '../components/SearchableSelect';
import PlanEditorModal from '../components/PlanEditorModal';
import HoverTooltip from '../components/HoverTooltip';

interface Props {
  selectedPlanId: string;
  onSelectPlan: (id: string) => void;
  onNavigate: (key: ViewKey) => void;
  onNavigateToEmails: (reportId: string) => void;
  focusReportId?: string;
  onFocusReportConsumed?: () => void;
}

type ReportMode = 'preview' | 'edit';

interface FocusState {
  report: ShortageReport;
  planId: string;
  planName: string;
  reportName: string;
  entryId: string | null;
  mode: ReportMode;
}

// Module-level cache so the focused report survives navigating away and back.
const cache: { focus: FocusState | null } = { focus: null };

const ShortageReportView: React.FC<Props> = ({
  selectedPlanId,
  onSelectPlan,
  onNavigate,
  onNavigateToEmails,
  focusReportId,
  onFocusReportConsumed,
}) => {
  const t = useT();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [focus, setFocus] = useState<FocusState | null>(cache.focus);
  const [history, setHistory] = useState<ShortageReportEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reassigningKey, setReassigningKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ShortageReportEntry | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [editingPlan, setEditingPlan] = useState<Partial<ProductionPlan> | null>(null);
  const [planModalReadOnly, setPlanModalReadOnly] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

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

  useEffect(() => {
    void (async () => {
      const [ps, ss, pr] = await Promise.all([
        window.electronAPI.listPlans(),
        window.electronAPI.listSuppliers(),
        window.electronAPI.listProducts(),
      ]);
      setPlans(ps);
      setSuppliers(ss);
      setProducts(pr);
      if (!selectedPlanId && ps[0]) onSelectPlan(ps[0].id);
      await loadHistory();
    })();
  }, []);

  // Open a specific report when navigated here from another view.
  useEffect(() => {
    if (!focusReportId) return;
    const entry = history.find((e) => e.id === focusReportId);
    if (entry) {
      openEntry(entry, 'preview');
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

  const compute = async () => {
    if (!selectedPlanId) return;
    const plan = plans.find((p) => p.id === selectedPlanId);
    setBusy(true);
    setError(null);
    try {
      const r = await window.electronAPI.computeShortages(selectedPlanId);
      const list = await loadHistory();
      const newest = list.find((e) => e.planId === selectedPlanId);
      setFocusAndCache({
        report: r,
        planId: selectedPlanId,
        planName: plan?.name ?? '',
        reportName: newest?.reportName ?? '',
        entryId: newest?.id ?? null,
        mode: 'edit',
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
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
      const r = await window.electronAPI.computeShortages(focus.planId);
      const list = await loadHistory();
      const newest = list.find((e) => e.planId === focus.planId);
      setFocusAndCache({ ...focus, report: r, entryId: newest?.id ?? null });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReassigningKey(null);
    }
  };

  const openEntry = (entry: ShortageReportEntry, mode: ReportMode) => {
    onSelectPlan(entry.planId);
    setError(null);
    setFocusAndCache({
      report: entry.report,
      planId: entry.planId,
      planName: entry.planName,
      reportName: entry.reportName,
      entryId: entry.id,
      mode,
    });
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const exitFocus = () => {
    setFocusAndCache(null);
    setError(null);
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

  const fmt = (n: number, unit: ShortageLine['unit']) =>
    n.toFixed(unit === 'pcs' ? 0 : 2);

  const missingLines = (e: ShortageReportEntry): ShortageLine[] => {
    return [...e.report.rawLines, ...e.report.componentLines]
      .filter((l) => l.shortage > 0)
      .sort((a, b) => b.shortage - a.shortage);
  };

  const hasPlans = plans.length > 0;

  // ----- Focused view (compute / edit / preview a single report) -----
  if (focus) {
    const { report, mode, reportName } = focus;
    return (
      <div className="main">
        <div className="focus-bar">
          <button className="btn" onClick={exitFocus} title={t.backToList}>
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
            <span className={`tag ${mode === 'edit' ? 'warn' : ''}`}>
              {mode === 'edit' ? t.editMode : t.previewMode}
            </span>
          </div>
          <div className="btn-row">
            {focus.planId && (
              <button
                className="btn"
                onClick={() => openPlanModal(focus.planId)}
                title={t.openPlan}
              >
                {t.openPlan}
              </button>
            )}
            {mode === 'preview' && (
              <button
                className="btn primary"
                onClick={() =>
                  setFocusAndCache({ ...focus, mode: 'edit' })
                }
                title={t.editMode}
              >
                <IconEdit size={13} /> {t.edit}
              </button>
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

        {error && <div className="card error-text">{error}</div>}

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

        {report.groups.length === 0 && (
          <div className="card">
            <strong>{t.noShortages}</strong>
          </div>
        )}

        {report.groups.map((g) => {
          const lines = [...g.rawLines, ...g.componentLines];
          if (lines.length === 0) return null;
          return (
            <div key={g.supplierId ?? '__none__'} className="card">
              <div className="card-header">
                <div className="card-title">
                  {g.supplierName}{' '}
                  {g.supplierEmail && (
                    <span className="hint" style={{ marginLeft: 8 }}>
                      &lt;{g.supplierEmail}&gt;
                    </span>
                  )}
                </div>
                <div className="hint">{lines.length} pozycji</div>
              </div>
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
      </div>

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

      {history.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t.olderReportsTitle}</div>
            <div className="hint">{t.olderReportsHint}</div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.reportName}</th>
                  <th>{t.selectedPlan}</th>
                  <th>{t.computedAtLabel}</th>
                  <th>{t.shortageReport}</th>
                  <th className="actions actions-sticky">{t.actionsHeader}</th>
                </tr>
              </thead>
              <tbody>
                {history.map((e) => {
                  const missing = missingLines(e);
                  const groups = e.report.groups.length;
                  const top = missing.slice(0, 8);
                  const livePlanName =
                    plans.find((p) => p.id === e.planId)?.name ?? e.planName;
                  return (
                  <tr
                    key={e.id}
                    className="row-clickable"
                    onClick={() => openEntry(e, 'preview')}
                    title={t.preview}
                  >
                    <td className="col-name col-wrap">{e.reportName}</td>
                    <td className="col-wrap">
                      <button
                        type="button"
                        className="link-button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          openPlanModal(e.planId);
                        }}
                        title={t.openPlan}
                      >
                        {livePlanName}
                      </button>
                    </td>
                    <td className="hint">{new Date(e.computedAt).toLocaleString()}</td>
                    <td>
                      {missing.length === 0 ? (
                        <span className="tag success">{t.noShortages}</span>
                      ) : (
                        <HoverTooltip
                          trigger={
                            <span className="shortage-summary">
                              <strong className="shortage-count">{missing.length}</strong>
                              <span className="hint">
                                {missing.length === 1
                                  ? 'brakująca pozycja'
                                  : 'brakujących pozycji'}
                                {' · '}
                                {groups} {groups === 1 ? 'dostawca' : 'dostawców'}
                              </span>
                            </span>
                          }
                        >
                          <div className="shortage-tooltip-header">
                            {t.shortageReport} — {missing.length}{' '}
                            {missing.length === 1 ? 'pozycja' : 'pozycji'}
                          </div>
                          <ul className="shortage-tooltip-list">
                            {top.map((line) => (
                              <li key={`${line.itemKind}-${line.itemId}`}>
                                <span className="shortage-tooltip-name">
                                  {line.itemName}
                                </span>
                                <span className="shortage-tooltip-amount">
                                  {fmt(line.shortage, line.unit)} {line.unit}
                                </span>
                              </li>
                            ))}
                          </ul>
                          {missing.length > top.length && (
                            <div className="shortage-tooltip-more hint">
                              + {missing.length - top.length}{' '}
                              {missing.length - top.length === 1 ? 'pozycja' : 'pozycji'}
                            </div>
                          )}
                        </HoverTooltip>
                      )}
                    </td>
                    <td
                      className="actions actions-sticky"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div className="btn-row">
                        <button
                          className="btn btn-sm"
                          onClick={() => openEntry(e, 'preview')}
                          title={t.preview}
                        >
                          <IconEye size={13} /> {t.preview}
                        </button>
                        <button
                          className="btn btn-sm soft-edit"
                          onClick={() => openEntry(e, 'edit')}
                          title={t.edit}
                        >
                          <IconEdit size={13} /> {t.edit}
                        </button>
                        <button
                          className="btn btn-sm soft-success"
                          onClick={() => onNavigateToEmails(e.id)}
                          disabled={e.report.groups.length === 0}
                          title={t.generateEmails}
                        >
                          <IconMail size={13} /> {t.generateEmails}
                        </button>
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={() => setConfirmDelete(e)}
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
      )}

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
    </div>
  );
};

export default ShortageReportView;
