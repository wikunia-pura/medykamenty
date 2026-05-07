import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { ViewKey } from './types';
import type { ShortageLine, ShortageReportEntry } from '../../shared/types';
import { IconImport } from '../components/Icons';
import drugsUrl from '../assets/drugs2.webp';

interface Props {
  onNavigate: (key: ViewKey) => void;
  onNavigateToReport: (planId: string, reportId: string) => void;
}

interface Counts {
  products: number;
  rawMaterials: number;
  components: number;
  suppliers: number;
  plans: number;
}

interface DataTile {
  key: ViewKey;
  label: string;
  value: number;
  icon: string;
  accent: 'blue' | 'green' | 'purple' | 'amber' | 'cyan';
}

const Dashboard: React.FC<Props> = ({ onNavigate, onNavigateToReport }) => {
  const t = useT();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [latestReport, setLatestReport] = useState<ShortageReportEntry | null>(null);

  const reload = async () => {
    const [products, rawMaterials, components, suppliers, plans, reports] = await Promise.all([
      window.electronAPI.listProducts(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
      window.electronAPI.listSuppliers(),
      window.electronAPI.listPlans(),
      window.electronAPI.listShortageReports(),
    ]);
    setCounts({
      products: products.length,
      rawMaterials: rawMaterials.length,
      components: components.length,
      suppliers: suppliers.length,
      plans: plans.length,
    });
    setLatestReport(reports[0] ?? null);
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isEmpty =
    counts !== null && counts.products === 0 && counts.suppliers === 0 && counts.plans === 0;

  const dataTiles: DataTile[] = counts
    ? [
        { key: 'products', label: t.products, value: counts.products, icon: '◐', accent: 'blue' },
        { key: 'rawMaterials', label: t.rawMaterials, value: counts.rawMaterials, icon: '⬡', accent: 'green' },
        { key: 'components', label: t.components, value: counts.components, icon: '▦', accent: 'purple' },
        { key: 'suppliers', label: t.suppliers, value: counts.suppliers, icon: '◉', accent: 'amber' },
        { key: 'productionPlan', label: t.productionPlan, value: counts.plans, icon: '▤', accent: 'cyan' },
      ]
    : [];

  const shortageLines: ShortageLine[] = latestReport
    ? [...latestReport.report.rawLines, ...latestReport.report.componentLines]
        .filter((l) => l.shortage > 0)
        .sort((a, b) => b.shortage - a.shortage)
    : [];
  const topShortages = shortageLines.slice(0, 8);
  const moreShortages = Math.max(0, shortageLines.length - topShortages.length);
  const reportDate = latestReport
    ? new Date(latestReport.computedAt).toLocaleDateString()
    : '';

  const fmt = (n: number, unit: ShortageLine['unit']) => n.toFixed(unit === 'pcs' ? 0 : 2);

  const hour = new Date().getHours();
  const greeting =
    hour < 5
      ? t.dashboardWelcomeNight
      : hour < 12
        ? t.dashboardWelcomeMorning
        : hour < 18
          ? t.dashboardWelcomeAfternoon
          : t.dashboardWelcomeEvening;

  return (
    <div className="main dashboard-main">
      <div className="dashboard-welcome-row">
        <section className="dashboard-welcome" aria-label={t.dashboard}>
          <div className="dashboard-welcome-orb dashboard-welcome-orb-a" aria-hidden />
          <div className="dashboard-welcome-orb dashboard-welcome-orb-b" aria-hidden />
          <div className="dashboard-welcome-orb dashboard-welcome-orb-c" aria-hidden />
          <div className="dashboard-welcome-content">
            <span className="dashboard-welcome-eyebrow">{t.dashboardWelcomeEyebrow}</span>
            <h1 className="dashboard-welcome-title">{greeting}</h1>
            <p className="dashboard-welcome-tagline">{t.dashboardWelcomeTagline}</p>
          </div>
        </section>
        <aside className="dashboard-welcome-image" aria-hidden>
          <img src={drugsUrl} alt="" className="dashboard-welcome-image-img" />
        </aside>
      </div>

      <h2 className="dashboard-section-head" style={{ marginTop: 8 }}>
        {t.dashboardYourData}
      </h2>
      <div className="dashboard-grid">
        {dataTiles.map((tile) => (
          <button
            key={tile.key}
            className={`dashboard-tile dashboard-tile-${tile.accent}`}
            onClick={() => onNavigate(tile.key)}
          >
            <span className="dashboard-tile-icon">{tile.icon}</span>
            <span className="dashboard-tile-count">{tile.value}</span>
            <span className="dashboard-tile-label">{tile.label}</span>
          </button>
        ))}
      </div>

      <h2 className="dashboard-section-head">
        {t.dashboardMissingItems}
        {latestReport && (
          <span className="dashboard-section-hint">
            {t.dashboardLastReport}: {latestReport.planName} · {reportDate}
          </span>
        )}
      </h2>

      {!latestReport && (
        <div className="dashboard-empty">
          <span className="dashboard-empty-icon">⚠</span>
          <div>
            <div className="dashboard-empty-title">{t.dashboardNoReportYet}</div>
            <button className="btn primary" onClick={() => onNavigate('productionPlan')}>
              {t.addPlanCta} →
            </button>
          </div>
        </div>
      )}

      {latestReport && topShortages.length === 0 && (
        <div className="dashboard-empty dashboard-empty-success">
          <span className="dashboard-empty-icon">✓</span>
          <div className="dashboard-empty-title">{t.dashboardNoMissing}</div>
        </div>
      )}

      {topShortages.length > 0 && (
        <>
          <div className="dashboard-grid dashboard-grid-shortage">
            {topShortages.map((line) => {
              const supplier =
                latestReport!.report.groups.find(
                  (g) =>
                    g.rawLines.some((l) => l.itemId === line.itemId) ||
                    g.componentLines.some((l) => l.itemId === line.itemId),
                )?.supplierName ?? '—';
              return (
                <button
                  key={`${line.itemKind}-${line.itemId}`}
                  className={`dashboard-shortage-tile dashboard-shortage-${line.itemKind}`}
                  onClick={() => onNavigateToReport(latestReport!.planId, latestReport!.id)}
                >
                  <div className="dashboard-shortage-head">
                    <span className="tag">
                      {line.itemKind === 'raw' ? 'surowiec' : 'komponent'}
                    </span>
                    <span className="dashboard-shortage-supplier" title={supplier}>
                      {supplier}
                    </span>
                  </div>
                  <div className="dashboard-shortage-name" title={line.itemName}>
                    {line.itemName}
                  </div>
                  <div className="dashboard-shortage-amount">
                    <span className="dashboard-shortage-amount-value">
                      {fmt(line.shortage, line.unit)}
                    </span>
                    <span className="dashboard-shortage-amount-unit">{line.unit}</span>
                  </div>
                  <div className="dashboard-shortage-foot">
                    {t.dashboardOrder}:{' '}
                    <strong>
                      {fmt(line.suggestedOrder, line.unit)} {line.unit}
                    </strong>
                  </div>
                  <div
                    className="dashboard-shortage-source"
                    title={`${latestReport!.planName} · ${reportDate}`}
                  >
                    <span className="dashboard-shortage-source-label">
                      {t.dashboardLastReport} · {reportDate}
                    </span>
                    <span className="dashboard-shortage-source-plan">
                      {latestReport!.planName}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="dashboard-shortage-more">
            {moreShortages > 0 && (
              <span className="hint">
                + {moreShortages} {moreShortages === 1 ? 'pozycja' : 'pozycji'}
              </span>
            )}
            <button className="btn primary" onClick={() => onNavigate('shortageReport')}>
              {t.dashboardSeeFullReport} →
            </button>
          </div>
        </>
      )}

      <button
        className={`dashboard-hero ${isEmpty ? 'dashboard-hero-pulse' : ''}`}
        onClick={() => onNavigate('stockImport')}
      >
        <span className="dashboard-hero-icon">
          <IconImport size={28} />
        </span>
        <span className="dashboard-hero-text">
          <span className="dashboard-hero-step">{t.dashboardStartStep}</span>
          <span className="dashboard-hero-title">{t.dashboardStartCta}</span>
          <span className="dashboard-hero-hint">{t.dashboardStartHint}</span>
        </span>
        <span className="dashboard-hero-arrow">→</span>
      </button>
    </div>
  );
};

export default Dashboard;
