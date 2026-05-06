import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type {
  ProductionPlan,
  ShortageLine,
  ShortageReport,
  ShortageReportEntry,
  Supplier,
} from '../../shared/types';
import type { ViewKey } from './types';
import ConfirmDialog from '../components/ConfirmDialog';
import NoPlansEmptyState from '../components/NoPlansEmptyState';
import { IconMail, IconPlus, IconTrash, IconEdit } from '../components/Icons';

interface Props {
  selectedPlanId: string;
  onSelectPlan: (id: string) => void;
  onNavigate: (key: ViewKey) => void;
  onNavigateToEmails: (planId: string) => void;
  onNavigateToEditPlan: (planId: string) => void;
}

// Module-level cache so the report survives navigating away and back.
const cache: {
  planId: string | null;
  report: ShortageReport | null;
  entryId: string | null;
} = {
  planId: null,
  report: null,
  entryId: null,
};

const ShortageReportView: React.FC<Props> = ({
  selectedPlanId,
  onSelectPlan,
  onNavigate,
  onNavigateToEmails,
  onNavigateToEditPlan,
}) => {
  const t = useT();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [report, setReport] = useState<ShortageReport | null>(
    cache.planId === selectedPlanId ? cache.report : null,
  );
  const [currentEntryId, setCurrentEntryId] = useState<string | null>(
    cache.planId === selectedPlanId ? cache.entryId : null,
  );
  const [history, setHistory] = useState<ShortageReportEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reassigningKey, setReassigningKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ShortageReportEntry | null>(null);

  const loadHistory = async () => {
    const list = await window.electronAPI.listShortageReports();
    setHistory(list);
    return list;
  };

  useEffect(() => {
    void (async () => {
      const [ps, ss] = await Promise.all([
        window.electronAPI.listPlans(),
        window.electronAPI.listSuppliers(),
      ]);
      setPlans(ps);
      setSuppliers(ss);
      if (!selectedPlanId && ps[0]) onSelectPlan(ps[0].id);
      await loadHistory();
    })();
  }, []);

  const setPlan = (id: string) => {
    onSelectPlan(id);
    setReport(cache.planId === id ? cache.report : null);
    setCurrentEntryId(cache.planId === id ? cache.entryId : null);
  };

  const compute = async () => {
    if (!selectedPlanId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.electronAPI.computeShortages(selectedPlanId);
      setReport(r);
      cache.planId = selectedPlanId;
      cache.report = r;
      // Refresh history; the most recent entry for this plan is the one just
      // produced. Pin its id so the history list can hide it from "older".
      const list = await loadHistory();
      const newest = list.find((e) => e.planId === selectedPlanId);
      setCurrentEntryId(newest?.id ?? null);
      cache.entryId = newest?.id ?? null;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reassignSupplier = async (line: ShortageLine, newSupplierId: string) => {
    if (!selectedPlanId) return;
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
      const r = await window.electronAPI.computeShortages(selectedPlanId);
      setReport(r);
      cache.planId = selectedPlanId;
      cache.report = r;
      const list = await loadHistory();
      const newest = list.find((e) => e.planId === selectedPlanId);
      setCurrentEntryId(newest?.id ?? null);
      cache.entryId = newest?.id ?? null;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReassigningKey(null);
    }
  };

  const onConfirmDelete = async () => {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    await window.electronAPI.deleteShortageReport(id);
    if (currentEntryId === id) {
      setReport(null);
      setCurrentEntryId(null);
      cache.report = null;
      cache.entryId = null;
    }
    await loadHistory();
  };

  const fmt = (n: number, unit: ShortageLine['unit']) =>
    n.toFixed(unit === 'pcs' ? 0 : 2);

  const hasPlans = plans.length > 0;
  const needsPlanChoice = hasPlans && !report;
  const olderEntries = history.filter((e) => e.id !== currentEntryId);

  const summarizeEntry = (e: ShortageReportEntry): string => {
    const r = e.report;
    const groups = r.groups.length;
    const lines = r.rawLines.length + r.componentLines.length;
    if (lines === 0) return t.noShortages;
    return `${groups} ${groups === 1 ? 'dostawca' : 'dostawców'} · ${lines} pozycji`;
  };

  return (
    <div className="main">
      <h1>{t.shortageReport}</h1>

      {!hasPlans ? (
        <NoPlansEmptyState onAddPlan={() => onNavigate('productionPlan')} />
      ) : (
        <div className={`card ${needsPlanChoice ? 'highlight-callout' : ''}`}>
          {needsPlanChoice && (
            <div className="callout-hint">
              <span>1.</span>
              <span>{t.selectPlanFirst}</span>
            </div>
          )}
          <div className="row" style={needsPlanChoice ? { justifyContent: 'center' } : undefined}>
            <select
              value={selectedPlanId}
              onChange={(e) => setPlan(e.target.value)}
              style={needsPlanChoice ? { minWidth: 280, fontSize: 15 } : undefined}
            >
              <option value="">— {t.selectPlanFirst} —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className={needsPlanChoice ? 'btn primary-filled' : 'btn primary'}
              onClick={compute}
              disabled={!selectedPlanId || busy}
            >
              {busy ? t.loading : t.computeShortages}
            </button>
            <button
              className="btn"
              onClick={() => onNavigate('productionPlan')}
              title={t.addPlanCta}
            >
              <IconPlus size={13} /> {t.addPlanCta}
            </button>
          </div>
          {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {report && report.warnings.length > 0 && (
        <div className="card" style={{ borderColor: 'var(--warning)' }}>
          <strong className="warn-text">{t.warnings}</strong>
          <ul>
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {report && report.groups.length === 0 && (
        <div className="card">
          <strong>{t.noShortages}</strong>
        </div>
      )}

      {report &&
        report.groups.map((g) => {
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
                          <select
                            className="supplier-select"
                            value={line.preferredSupplierId ?? ''}
                            disabled={reassigningKey === key}
                            onChange={(e) => reassignSupplier(line, e.target.value)}
                            title={t.selectSupplier}
                          >
                            <option value="">— {t.selectSupplier} —</option>
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
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

      {olderEntries.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title">{t.olderReportsTitle}</div>
            <div className="hint">{t.olderReportsHint}</div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.planName}</th>
                  <th>{t.computedAtLabel}</th>
                  <th>{t.shortageReport}</th>
                  <th className="actions">{t.actionsHeader}</th>
                </tr>
              </thead>
              <tbody>
                {olderEntries.map((e) => {
                  const planExists = plans.some((p) => p.id === e.planId);
                  return (
                    <tr key={e.id}>
                      <td className="col-name col-wrap">{e.planName}</td>
                      <td className="hint">{new Date(e.computedAt).toLocaleString()}</td>
                      <td className="hint">{summarizeEntry(e)}</td>
                      <td className="actions">
                        <div className="btn-row">
                          <button
                            className="btn btn-sm soft-success"
                            onClick={() => onNavigateToEmails(e.planId)}
                            title={t.generateEmails}
                            disabled={!planExists}
                          >
                            <IconMail size={13} /> {t.generateEmails}
                          </button>
                          <button
                            className="btn btn-sm soft-edit"
                            onClick={() => onNavigateToEditPlan(e.planId)}
                            title={t.edit}
                            disabled={!planExists}
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

      {report && (
        <button
          className="floating-next"
          onClick={() => onNavigateToEmails(selectedPlanId)}
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

      {confirmDelete && (
        <ConfirmDialog
          message={`${t.deleteReportConfirm}: ${confirmDelete.planName} (${new Date(
            confirmDelete.computedAt,
          ).toLocaleString()})?`}
          onConfirm={onConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}
    </div>
  );
};

export default ShortageReportView;
