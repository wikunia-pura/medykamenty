import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import type { ProductionPlan, RFQEmail, Lang } from '../../shared/types';
import type { ViewKey } from './types';
import AIToggleButton from '../components/AIToggleButton';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import NoPlansEmptyState from '../components/NoPlansEmptyState';
import { IconCopy, IconCheck, IconMail, IconSparkles } from '../components/Icons';

interface Props {
  defaultLanguage: Lang;
  aiAvailable: boolean;
  useAiByDefault: boolean;
  selectedPlanId: string;
  onSelectPlan: (id: string) => void;
  autoGenerate?: boolean;
  onAutoGenerateConsumed?: () => void;
  onNavigate?: (key: ViewKey) => void;
}

const EmailGenerator: React.FC<Props> = ({
  defaultLanguage,
  aiAvailable,
  useAiByDefault,
  selectedPlanId,
  onSelectPlan,
  autoGenerate,
  onAutoGenerateConsumed,
  onNavigate,
}) => {
  const t = useT();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [language, setLanguage] = useState<Lang>(defaultLanguage);
  const [useAi, setUseAi] = useState(useAiByDefault);
  const [emails, setEmails] = useState<RFQEmail[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [refining, setRefining] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const filteredEmails = useMemo(() => {
    if (!query.trim()) return emails.map((e, idx) => ({ e, idx }));
    return emails
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => matchesQuery(e, query));
  }, [emails, query]);

  useEffect(() => {
    void (async () => {
      const ps = await window.electronAPI.listPlans();
      setPlans(ps);
      if (!selectedPlanId && ps[0]) onSelectPlan(ps[0].id);
    })();
  }, []);

  const generate = async () => {
    if (!selectedPlanId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.generateEmails(selectedPlanId, {
        language,
        useAI: useAi && aiAvailable,
      });
      setEmails(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Auto-generate when navigated here from the shortage report (wizard step 2 → 3).
  useEffect(() => {
    if (!autoGenerate || !selectedPlanId) return;
    onAutoGenerateConsumed?.();
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerate, selectedPlanId]);

  const copy = async (idx: number) => {
    try {
      await navigator.clipboard.writeText(emails[idx].body);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    } catch {
      setError(t.copyFailed);
    }
  };

  const refineOne = async (idx: number) => {
    setRefining(idx);
    try {
      const refined = await window.electronAPI.rewriteEmailWithAI(
        emails[idx].body,
        emails[idx].language,
        { supplierName: emails[idx].supplierName },
      );
      const next = emails.slice();
      next[idx] = { ...next[idx], body: refined, refinedByAI: true };
      setEmails(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefining(null);
    }
  };

  const updateBody = (idx: number, value: string) => {
    const next = emails.slice();
    next[idx] = { ...next[idx], body: value };
    setEmails(next);
  };

  const mailtoHref = (e: RFQEmail) =>
    `mailto:${encodeURIComponent(e.to)}?subject=${encodeURIComponent(
      e.subject,
    )}&body=${encodeURIComponent(e.body)}`;

  if (plans.length === 0) {
    return (
      <div className="main">
        <h1>{t.emailGenerator}</h1>
        <NoPlansEmptyState onAddPlan={() => onNavigate?.('productionPlan')} />
      </div>
    );
  }

  return (
    <div className="main">
      <div className="page-header">
        <h1>{t.emailGenerator}</h1>
        {emails.length > 0 && <span className="page-header-count">({emails.length})</span>}
      </div>

      <div className="card">
        <div className="row">
          <select value={selectedPlanId} onChange={(e) => onSelectPlan(e.target.value)}>
            <option value="">—</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label className="hint">{t.emailLanguage}:</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
            <option value="pl">PL</option>
            <option value="en">EN</option>
          </select>
          <AIToggleButton enabled={useAi} onChange={setUseAi} available={aiAvailable} />
          <div className="spacer" />
          <button className="btn primary" disabled={!selectedPlanId || busy} onClick={generate}>
            {busy ? t.loading : t.generateEmails}
          </button>
        </div>
        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
        {emails.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <SearchInput value={query} onChange={setQuery} />
          </div>
        )}
      </div>

      {emails.length === 0 && <div className="card hint">{t.noData}</div>}
      {emails.length > 0 && filteredEmails.length === 0 && (
        <div className="card hint">—</div>
      )}

      {filteredEmails.map(({ e, idx }) => (
        <div key={idx} className="card">
          <div className="card-header">
            <div className="card-title">
              {e.supplierName}{' '}
              {e.to && (
                <span className="hint" style={{ marginLeft: 8 }}>
                  &lt;{e.to}&gt;
                </span>
              )}{' '}
              {e.refinedByAI && <span className="tag success">AI</span>}
            </div>
            <div className="btn-row">
              <button
                className="btn btn-sm soft-warn"
                onClick={() => refineOne(idx)}
                disabled={!aiAvailable || refining === idx}
                title={aiAvailable ? t.refineWithAI : t.aiUnavailable}
              >
                <IconSparkles size={13} />{' '}
                {refining === idx ? t.loading : t.refineWithAI}
              </button>
              <button
                className={`btn btn-sm ${copiedIdx === idx ? 'soft-success' : 'soft-edit'}`}
                onClick={() => copy(idx)}
                title={t.copy}
              >
                {copiedIdx === idx ? <IconCheck size={13} /> : <IconCopy size={13} />}{' '}
                {copiedIdx === idx ? t.copied : t.copy}
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
            </div>
          </div>
          <div className="form-row">
            <label>Subject</label>
            <input className="input" readOnly value={e.subject} />
          </div>
          <textarea
            value={e.body}
            onChange={(ev) => updateBody(idx, ev.target.value)}
            rows={Math.min(20, Math.max(8, e.body.split('\n').length + 1))}
          />
        </div>
      ))}
    </div>
  );
};

export default EmailGenerator;
