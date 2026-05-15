import React, { useEffect, useMemo, useState } from 'react';
import { useT, useLang } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  ProductionPlan,
  CostReport,
  Product,
  RawMaterial,
  PackagingComponent,
} from '../../shared/types';
import type { ViewKey } from './types';
import NoPlansEmptyState from '../components/NoPlansEmptyState';
import LoadingOverlay from '../components/LoadingOverlay';
import MultiSelect from '../components/MultiSelect';
import HoverTooltip from '../components/HoverTooltip';
import PlanEditorModal from '../components/PlanEditorModal';
import ProductEditorModal from '../components/ProductEditorModal';
import { IconRefresh, IconChevronDown } from '../components/Icons';

interface Props {
  onNavigate?: (key: ViewKey) => void;
}

// Persist selection + computed reports + expanded card ids across view-switches
// and app restarts, matching the MaxProducible view. The Refresh button is the
// recompute path, so stale results from a previous session are acceptable.
const STORAGE_KEY = 'cutis.costCalculator.state';

interface PersistedState {
  planIds: string[];
  reports: CostReport[];
  expandedIds: string[];
}

const EMPTY_STATE: PersistedState = { planIds: [], reports: [], expandedIds: [] };

const loadState = (): PersistedState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_STATE;
    const planIds = Array.isArray(parsed.planIds)
      ? parsed.planIds.filter((x: unknown): x is string => typeof x === 'string')
      : [];
    const reports = Array.isArray(parsed.reports) ? (parsed.reports as CostReport[]) : [];
    const expandedIds = Array.isArray(parsed.expandedIds)
      ? parsed.expandedIds.filter((x: unknown): x is string => typeof x === 'string')
      : [];
    return { planIds, reports, expandedIds };
  } catch {
    return EMPTY_STATE;
  }
};

const saveState = (state: PersistedState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
};

const CostCalculatorView: React.FC<Props> = ({ onNavigate }) => {
  const t = useT();
  const lang = useLang();
  const locale = lang === 'pl' ? 'pl-PL' : 'en-US';
  const [plans, setPlans] = useState<ProductionPlan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [planIds, setPlanIds] = useState<string[]>(() => loadState().planIds);
  const [reports, setReports] = useState<CostReport[]>(() => loadState().reports);
  const [expandedIds, setExpandedIds] = useState<string[]>(() => loadState().expandedIds);
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editingPlan, setEditingPlan] = useState<Partial<ProductionPlan> | null>(null);
  const [planModalReadOnly, setPlanModalReadOnly] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [productModalReadOnly, setProductModalReadOnly] = useState(false);

  const reload = async () => {
    const [ps, pr, rm, cs] = await Promise.all([
      window.electronAPI.listPlans(),
      window.electronAPI.listProducts(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
    ]);
    setPlans(ps);
    setProducts(pr);
    setRawMaterials(rm);
    setComponents(cs);
    const existingIds = new Set(ps.map((p) => p.id));
    setPlanIds((prev) => prev.filter((id) => existingIds.has(id)));
    setReports((prev) => prev.filter((r) => existingIds.has(r.planId)));
    setExpandedIds((prev) => prev.filter((id) => existingIds.has(id)));
  };

  useEffect(() => {
    void (async () => {
      setLoaderMessage(t.loading);
      try {
        await reload();
      } finally {
        setLoaderMessage(null);
      }
    })();
  }, []);

  const openPlanPreview = (planId: string) => {
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
    await reload();
  };

  const openProductPreview = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setEditingProduct({ ...p });
    setProductModalReadOnly(true);
  };
  const closeProductModal = () => {
    setEditingProduct(null);
    setProductModalReadOnly(false);
  };
  const saveProduct = async () => {
    if (!editingProduct?.id || !editingProduct.name?.trim()) return;
    await window.electronAPI.updateProduct(editingProduct.id, {
      name: editingProduct.name.trim(),
      sku: editingProduct.sku?.trim() || undefined,
      capacityMl: editingProduct.capacityMl ?? 0,
      densityGPerMl: editingProduct.densityGPerMl ?? 1,
      conversionLaborCost: editingProduct.conversionLaborCost,
      ingredients: editingProduct.ingredients ?? [],
      packaging: editingProduct.packaging ?? [],
      packingScheme: editingProduct.packingScheme,
      notes: editingProduct.notes?.trim() || undefined,
      archived: !!editingProduct.archived,
    });
    closeProductModal();
    await reload();
  };

  useEffect(() => {
    saveState({ planIds, reports, expandedIds });
  }, [planIds, reports, expandedIds]);

  const planNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of plans) map.set(p.id, p.name);
    return map;
  }, [plans]);

  const toggleExpanded = (planId: string) => {
    setExpandedIds((prev) =>
      prev.includes(planId) ? prev.filter((id) => id !== planId) : [...prev, planId],
    );
  };

  const compute = async () => {
    if (planIds.length === 0) return;
    setBusy(true);
    setLoaderMessage(t.loaderComputing);
    setError(null);
    try {
      const next = await Promise.all(
        planIds.map((id) => window.electronAPI.computeCost(id)),
      );
      setReports(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (plans.length === 0) {
    return (
      <div className="main">
        <div className="page-header">
          <HeaderNav />
          <h1>{t.costCalculator}</h1>
        </div>
        <NoPlansEmptyState onAddPlan={() => onNavigate?.('productionPlan')} />
      </div>
    );
  }

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.costCalculator}</h1>
      </div>
      <div className="compute-hero">
        <span className="compute-hero-icon" aria-hidden>
          💰
        </span>
        <div className="compute-hero-text">
          <span className="compute-hero-title">{t.computeCost}</span>
          <span className="compute-hero-hint">{t.costCalculatorHeroHint}</span>
          <div className="compute-hero-controls">
            <MultiSelect
              options={plans.map((p) => ({ value: p.id, label: p.name }))}
              selected={planIds}
              onChange={setPlanIds}
              placeholder={t.costCalculatorSelectPlans}
              selectAllLabel={t.maxProducibleSelectAll}
              clearLabel={t.maxProducibleClearSelection}
              selectedCountLabel={t.maxProducibleSelectedCount}
            />
            <button
              className="compute-hero-cta"
              disabled={planIds.length === 0 || busy}
              onClick={compute}
            >
              {busy ? t.loading : t.computeCost} →
            </button>
          </div>
          {error && <div className="compute-hero-error">{error}</div>}
        </div>
      </div>

      {reports.length > 0 && (
        <div className="maxprod-results-header">
          <button
            type="button"
            className="btn primary-filled maxprod-refresh-btn"
            onClick={compute}
            disabled={busy || planIds.length === 0}
            title={t.maxProducibleRefresh}
          >
            <IconRefresh size={16} className={busy ? 'spinning' : undefined} />
            <span>{t.maxProducibleRefresh}</span>
          </button>
        </div>
      )}

      {reports.map((report) => {
        const planName = planNameById.get(report.planId) ?? '—';
        const productCount = report.perProduct.length;
        const totalMissing = report.perProduct.reduce(
          (acc, line) => acc + line.missingPriceItems.length,
          0,
        );
        const isExpanded = expandedIds.includes(report.planId);
        const hasDetails = productCount > 0;

        return (
          <div
            key={report.planId}
            className={`card maxprod-result${hasDetails ? ' is-clickable' : ''}${
              isExpanded ? ' is-expanded' : ''
            }`}
            onClick={hasDetails ? () => toggleExpanded(report.planId) : undefined}
            role={hasDetails ? 'button' : undefined}
            tabIndex={hasDetails ? 0 : undefined}
            onKeyDown={
              hasDetails
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpanded(report.planId);
                    }
                  }
                : undefined
            }
          >
            <div className="maxprod-product-row">
              <button
                type="button"
                className="link-button maxprod-product"
                onClick={(ev) => {
                  ev.stopPropagation();
                  openPlanPreview(report.planId);
                }}
                title={t.openPlan}
              >
                {planName}
              </button>
              {hasDetails && (
                <span className="maxprod-expand-affordance">
                  <span className="maxprod-expand-label">
                    {isExpanded ? t.maxProducibleHideDetails : t.maxProducibleShowDetails}
                  </span>
                  <IconChevronDown size={14} className="maxprod-expand-chevron" />
                </span>
              )}
            </div>

            <div className="maxprod-hero">
              <div className="maxprod-hero-label">{t.totalPlanCost}</div>
              <div className="maxprod-hero-value">
                <span className="maxprod-hero-num">{fmt(report.totalPlanCost)}</span>
                <span className="maxprod-hero-unit">PLN</span>
              </div>
            </div>

            <div className="maxprod-status cost-status">
              <span className="cost-status-pill">
                <span className="cost-status-pill-num">{productCount}</span>
                <span className="cost-status-pill-label">{t.products}</span>
              </span>
              {totalMissing > 0 && (
                <HoverTooltip
                  align="left"
                  trigger={
                    <span className="cost-status-pill is-warn">
                      <span className="cost-status-pill-num">{totalMissing}</span>
                      <span className="cost-status-pill-label">{t.missingPrices}</span>
                    </span>
                  }
                >
                  <div className="shortage-tooltip-explain">
                    {t.missingPricesTooltipExplain}
                  </div>
                </HoverTooltip>
              )}
            </div>

            {hasDetails && isExpanded && (
              <div className="maxprod-details" onClick={(e) => e.stopPropagation()}>
                <div className="maxprod-details-header">{t.unitCost}</div>
                <div className="table-wrap">
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
                          <td>
                            <button
                              type="button"
                              className="link-button"
                              onClick={(ev) => {
                                ev.stopPropagation();
                                openProductPreview(line.productId);
                              }}
                              title={t.preview}
                            >
                              {line.productName}
                            </button>
                          </td>
                          <td className="num">
                            <strong>{fmt(line.unitCost)}</strong>
                          </td>
                          <td className="num">{fmt(line.ingredientsCost)}</td>
                          <td className="num">{fmt(line.packagingCost)}</td>
                          <td className="num">{fmt(line.laborCost)}</td>
                          <td>
                            {line.missingPriceItems.length === 0 ? (
                              <HoverTooltip
                                align="right"
                                trigger={<span className="tag success">✓</span>}
                              >
                                <div className="shortage-tooltip-explain">
                                  {t.missingPricesAllPriced}
                                </div>
                              </HoverTooltip>
                            ) : (
                              <HoverTooltip
                                align="right"
                                triggerClassName="count-bubble"
                                trigger={
                                  <span className="tag warn">
                                    {line.missingPriceItems.length}
                                  </span>
                                }
                              >
                                <div className="shortage-tooltip-header">
                                  {t.missingPricesTooltipHeader} —{' '}
                                  {line.missingPriceItems.length}
                                </div>
                                <div className="shortage-tooltip-explain">
                                  {t.missingPricesTooltipExplain}
                                </div>
                                <ul className="shortage-tooltip-list">
                                  {line.missingPriceItems.map((m) => (
                                    <li key={`${m.kind}-${m.itemId}`}>
                                      <span className="shortage-tooltip-name">
                                        {m.itemName}
                                      </span>
                                      <span className="tag">
                                        {m.kind === 'raw' ? t.rawMaterials : t.components}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </HoverTooltip>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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

      {editingProduct && (
        <ProductEditorModal
          editing={editingProduct}
          rawMaterials={rawMaterials}
          components={components}
          setEditing={setEditingProduct}
          onCancel={closeProductModal}
          onSave={saveProduct}
          readOnly={productModalReadOnly}
          onEnterEdit={() => setProductModalReadOnly(false)}
        />
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

export default CostCalculatorView;
