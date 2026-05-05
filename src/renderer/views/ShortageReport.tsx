import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { ProductionPlan, ShortageReport } from '../../shared/types';

const ShortageReportView: React.FC = () => {
  const t = useT();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [planId, setPlanId] = useState<string>('');
  const [report, setReport] = useState<ShortageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const ps = await window.electronAPI.listPlans();
      setPlans(ps);
      if (ps[0]) setPlanId(ps[0].id);
    })();
  }, []);

  const compute = async () => {
    if (!planId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.electronAPI.computeShortages(planId);
      setReport(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="main">
      <h1>{t.shortageReport}</h1>

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
          <button className="btn primary" onClick={compute} disabled={!planId || busy}>
            {busy ? t.loading : t.computeShortages}
          </button>
        </div>
        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      </div>

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
          const totalLines = g.rawLines.length + g.componentLines.length;
          if (totalLines === 0) return null;
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
                <div className="hint">
                  {totalLines} pozycji
                </div>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th>Typ</th>
                    <th className="num">{t.required}</th>
                    <th className="num">{t.available}</th>
                    <th className="num">{t.shortage}</th>
                    <th className="num">{t.suggestedOrder}</th>
                    <th className="num">{t.moq}</th>
                    <th>{t.unit}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...g.rawLines, ...g.componentLines].map((line) => (
                    <tr key={`${line.itemKind}-${line.itemId}`}>
                      <td>{line.itemName}</td>
                      <td>
                        <span className="tag">{line.itemKind === 'raw' ? 'surowiec' : 'komponent'}</span>
                      </td>
                      <td className="num">{line.required.toFixed(line.unit === 'pcs' ? 0 : 2)}</td>
                      <td className="num">{line.available.toFixed(line.unit === 'pcs' ? 0 : 2)}</td>
                      <td className="num error-text">
                        {line.shortage.toFixed(line.unit === 'pcs' ? 0 : 2)}
                      </td>
                      <td className="num">
                        <strong>
                          {line.suggestedOrder.toFixed(line.unit === 'pcs' ? 0 : 2)}
                        </strong>
                      </td>
                      <td className="num">{line.moq ?? ''}</td>
                      <td>{line.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
    </div>
  );
};

export default ShortageReportView;
