import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { ProductionPlan, RFQEmail, Lang } from '../../shared/types';
import AIToggleButton from '../components/AIToggleButton';

interface Props {
  defaultLanguage: Lang;
  aiAvailable: boolean;
  useAiByDefault: boolean;
}

const EmailGenerator: React.FC<Props> = ({ defaultLanguage, aiAvailable, useAiByDefault }) => {
  const t = useT();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [planId, setPlanId] = useState<string>('');
  const [language, setLanguage] = useState<Lang>(defaultLanguage);
  const [useAi, setUseAi] = useState(useAiByDefault);
  const [emails, setEmails] = useState<RFQEmail[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [refining, setRefining] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      const ps = await window.electronAPI.listPlans();
      setPlans(ps);
      if (ps[0]) setPlanId(ps[0].id);
    })();
  }, []);

  const generate = async () => {
    if (!planId) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.generateEmails(planId, {
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

  return (
    <div className="main">
      <h1>{t.emailGenerator}</h1>

      <div className="card">
        <div className="row">
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
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
          <button className="btn primary" disabled={!planId || busy} onClick={generate}>
            {busy ? t.loading : t.generateEmails}
          </button>
        </div>
        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {emails.length === 0 && <div className="card hint">{t.noData}</div>}

      {emails.map((e, idx) => (
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
                className="btn btn-sm"
                onClick={() => refineOne(idx)}
                disabled={!aiAvailable || refining === idx}
                title={aiAvailable ? t.refineWithAI : t.aiUnavailable}
              >
                {refining === idx ? t.loading : `AI: ${t.refineWithAI}`}
              </button>
              <button className="btn btn-sm" onClick={() => copy(idx)}>
                {copiedIdx === idx ? t.copied : t.copy}
              </button>
              {e.to && (
                <a className="btn btn-sm" href={mailtoHref(e)}>
                  mailto:
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
