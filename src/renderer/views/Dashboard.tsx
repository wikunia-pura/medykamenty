import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { ViewKey } from './types';
import ConfirmDialog from '../components/ConfirmDialog';

interface Props {
  onNavigate: (key: ViewKey) => void;
}

interface Counts {
  products: number;
  rawMaterials: number;
  components: number;
  suppliers: number;
  plans: number;
}

const Dashboard: React.FC<Props> = ({ onNavigate }) => {
  const t = useT();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [confirmDemo, setConfirmDemo] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [wipeBusy, setWipeBusy] = useState(false);
  const [wipeMessage, setWipeMessage] = useState<string | null>(null);

  const reload = async () => {
    const [products, rawMaterials, components, suppliers, plans] = await Promise.all([
      window.electronAPI.listProducts(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
      window.electronAPI.listSuppliers(),
      window.electronAPI.listPlans(),
    ]);
    setCounts({
      products: products.length,
      rawMaterials: rawMaterials.length,
      components: components.length,
      suppliers: suppliers.length,
      plans: plans.length,
    });
  };

  const runDemo = async () => {
    setConfirmDemo(false);
    setDemoBusy(true);
    setDemoMessage(null);
    try {
      await window.electronAPI.seedDemo();
      await reload();
      setDemoMessage(t.loadDemoSuccess);
    } catch (err) {
      setDemoMessage((err as Error).message);
    } finally {
      setDemoBusy(false);
    }
  };

  const runWipe = async () => {
    setConfirmWipe(false);
    setWipeBusy(true);
    setWipeMessage(null);
    try {
      await window.electronAPI.wipeData();
      await reload();
      setWipeMessage(t.wipeDataSuccess);
      setDemoMessage(null);
    } catch (err) {
      setWipeMessage((err as Error).message);
    } finally {
      setWipeBusy(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isEmpty = counts !== null && counts.products === 0 && counts.suppliers === 0;

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

  const steps = [
    t.firstTimeStep1,
    t.firstTimeStep2,
    t.firstTimeStep3,
    t.firstTimeStep4,
    t.firstTimeStep5,
    t.firstTimeStep6,
    t.firstTimeStep7,
  ];

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

      <details
        className="card"
        style={{
          padding: 0,
          marginTop: 24,
          borderColor: isEmpty ? 'var(--primary)' : undefined,
        }}
      >
        <summary
          style={{
            padding: 16,
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 15,
            listStyle: 'revert',
          }}
        >
          {t.firstTimeTitle}
        </summary>
        <div style={{ padding: '0 16px 16px' }}>
          <ol style={{ paddingLeft: 24, margin: '4px 0 16px', lineHeight: 1.7 }}>
            {steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          <div className="hint" style={{ marginBottom: 12 }}>{t.firstTimeDemoHint}</div>
          <div className="btn-row">
            <button
              className={`btn ${isEmpty ? 'primary' : ''}`}
              disabled={demoBusy}
              onClick={() => setConfirmDemo(true)}
            >
              {demoBusy ? t.loading : t.loadDemoButton}
            </button>
          </div>
          {demoMessage && (
            <div className="hint" style={{ marginTop: 12 }}>
              {demoMessage}
            </div>
          )}
        </div>
      </details>

      {!isEmpty && (
        <>
          <h2>{t.wipeDataTitle}</h2>
          <div className="card">
            <div className="hint" style={{ marginBottom: 12 }}>{t.wipeDataBody}</div>
            <div className="btn-row">
              <button
                className="btn"
                disabled={wipeBusy}
                onClick={() => setConfirmWipe(true)}
              >
                {wipeBusy ? t.loading : t.wipeDataButton}
              </button>
            </div>
            {wipeMessage && (
              <div className="hint" style={{ marginTop: 12 }}>
                {wipeMessage}
              </div>
            )}
          </div>
        </>
      )}

      {confirmDemo && (
        <ConfirmDialog
          message={t.loadDemoConfirm}
          onConfirm={runDemo}
          onCancel={() => setConfirmDemo(false)}
          danger
        />
      )}

      {confirmWipe && (
        <ConfirmDialog
          message={t.wipeDataConfirm}
          onConfirm={runWipe}
          onCancel={() => setConfirmWipe(false)}
          danger
        />
      )}
    </div>
  );
};

export default Dashboard;
