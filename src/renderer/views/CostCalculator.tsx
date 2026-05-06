import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { ProductionPlan, CostReport } from '../../shared/types';
import type { ViewKey } from './types';
import NoPlansEmptyState from '../components/NoPlansEmptyState';

interface Props {
  onNavigate?: (key: ViewKey) => void;
}

const CostCalculatorView: React.FC<Props> = ({ onNavigate }) => {
  const t = useT();
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [planId, setPlanId] = useState<string>('');
  const [report, setReport] = useState<CostReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const r = await window.electronAPI.computeCost(planId);
      setReport(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (plans.length === 0) {
    return (
      <div className="main">
        <h1>{t.costCalculator}</h1>
        <NoPlansEmptyState onAddPlan={() => onNavigate?.('productionPlan')} />
      </div>
    );
  }

  return (
    <div className="main">
      <h1>{t.costCalculator}</h1>
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
          <button className="btn primary" disabled={!planId || busy} onClick={compute}>
            {busy ? t.loading : t.computeCost}
          </button>
        </div>
        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {report && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t.totalPlanCost}: {fmt(report.totalPlanCost)} PLN</h2>
          <table className="table">
            <thead>
              <tr>
                <th>{t.products}</th>
                <th className="num">{t.unitCost}</th>
                <th className="num">{t.ingredients}</th>
                <th className="num">{t.packaging}</th>
                <th className="num">{t.laborCost}</th>
                <th>{t.missingPrices}</th>
              </tr>
            </thead>
            <tbody>
              {report.perProduct.map((line) => (
                <tr key={line.productId}>
                  <td>{line.productName}</td>
                  <td className="num">
                    <strong>{fmt(line.unitCost)}</strong>
                  </td>
                  <td className="num">{fmt(line.ingredientsCost)}</td>
                  <td className="num">{fmt(line.packagingCost)}</td>
                  <td className="num">{fmt(line.laborCost)}</td>
                  <td>
                    {line.missingPriceItems.length === 0 ? (
                      <span className="tag success">✓</span>
                    ) : (
                      <span className="tag warn" title={line.missingPriceItems.map((m) => m.itemName).join(', ')}>
                        {line.missingPriceItems.length}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CostCalculatorView;
