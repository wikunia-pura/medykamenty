import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { ViewKey } from './types';
import type { StockSnapshot } from '../../shared/types';

interface Props {
  onNavigate: (key: ViewKey) => void;
  aiAvailable: boolean;
}

interface Counts {
  products: number;
  rawMaterials: number;
  components: number;
  suppliers: number;
  plans: number;
}

const Dashboard: React.FC<Props> = ({ onNavigate, aiAvailable }) => {
  const t = useT();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<StockSnapshot | undefined>();

  useEffect(() => {
    void (async () => {
      const [products, rawMaterials, components, suppliers, plans, snapshots] = await Promise.all([
        window.electronAPI.listProducts(),
        window.electronAPI.listRawMaterials(),
        window.electronAPI.listComponents(),
        window.electronAPI.listSuppliers(),
        window.electronAPI.listPlans(),
        window.electronAPI.listStockSnapshots(),
      ]);
      setCounts({
        products: products.length,
        rawMaterials: rawMaterials.length,
        components: components.length,
        suppliers: suppliers.length,
        plans: plans.length,
      });
      setLatestSnapshot(snapshots[0]);
    })();
  }, []);

  const tile = (label: string, value: number, target: ViewKey) => (
    <div
      className="card"
      style={{ cursor: 'pointer', minWidth: 160 }}
      onClick={() => onNavigate(target)}
    >
      <div className="hint">{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 8 }}>{value}</div>
    </div>
  );

  return (
    <div className="main">
      <h1>{t.dashboard}</h1>
      <p className="subtitle">{t.appName} — {t.version} alpha</p>

      <div className="row">
        {counts && tile(t.products, counts.products, 'products')}
        {counts && tile(t.rawMaterials, counts.rawMaterials, 'rawMaterials')}
        {counts && tile(t.components, counts.components, 'components')}
        {counts && tile(t.suppliers, counts.suppliers, 'suppliers')}
        {counts && tile(t.productionPlan, counts.plans, 'productionPlan')}
      </div>

      <h2>{t.stockImport}</h2>
      {latestSnapshot ? (
        <div className="card">
          <div>
            <strong>{latestSnapshot.sourceFile}</strong>{' '}
            <span className="hint">
              ({new Date(latestSnapshot.importedAt).toLocaleString()},{' '}
              {latestSnapshot.rows.length} {t.rowsImported.toLowerCase()})
            </span>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => onNavigate('stockImport')}>
              {t.stockImport}
            </button>
            <button className="btn primary" onClick={() => onNavigate('productionPlan')}>
              {t.productionPlan}
            </button>
          </div>
        </div>
      ) : (
        <div className="card">
          <div>{t.noStockYet}</div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => onNavigate('stockImport')}>
              {t.stockImport}
            </button>
          </div>
        </div>
      )}

      <h2>{t.settingsLLM}</h2>
      <div className="card">
        <div>
          {t.settingsLLMStatus}:{' '}
          {aiAvailable ? <span className="tag success">available</span> : <span className="tag">unavailable</span>}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
