import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useT, useLang } from '../i18n';
import { VIEW_ICONS } from '../viewIcons';
import { HeaderNav } from '../navigation';
import type {
  ProductionPlan,
  CostReport,
  CostItemKind,
  CostItemLine,
  Product,
  RawMaterial,
  PackagingComponent,
  PriceHistoryEntry,
} from '../../shared/types';
import type { ViewKey } from './types';
import NoPlansEmptyState from '../components/NoPlansEmptyState';
import LoadingOverlay from '../components/LoadingOverlay';
import MultiSelect from '../components/MultiSelect';
import HoverTooltip from '../components/HoverTooltip';
import PlanEditorModal from '../components/PlanEditorModal';
import ProductEditorModal from '../components/ProductEditorModal';
import PriceCell from '../components/PriceCell';
import IconButton from '../components/IconButton';
import { IconRefresh, IconChevronDown } from '../components/Icons';

interface Props {
  onNavigate?: (key: ViewKey) => void;
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// Persist selection + computed reports + expanded card ids across view-switches
// and app restarts. On entry the view auto-recomputes against the current
// source data, so the persisted reports just render as a placeholder while the
// fresh compute runs — they cannot linger as stale numbers.
const STORAGE_KEY = 'cutis.costCalculator.state';

interface PersistedState {
  planIds: string[];
  reports: CostReport[];
  expandedIds: string[];
  // Product drill-downs left open, keyed `${planId}:${productId}`.
  expandedItemKeys: string[];
}

const EMPTY_STATE: PersistedState = {
  planIds: [],
  reports: [],
  expandedIds: [],
  expandedItemKeys: [],
};

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
    const expandedItemKeys = Array.isArray(parsed.expandedItemKeys)
      ? parsed.expandedItemKeys.filter((x: unknown): x is string => typeof x === 'string')
      : [];
    return { planIds, reports, expandedIds, expandedItemKeys };
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
  const [expandedItemKeys, setExpandedItemKeys] = useState<string[]>(
    () => loadState().expandedItemKeys,
  );
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  // Set while the entry refresh runs, so it computes without the overlay.
  const quietRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  // A failed first load must not read as "no plans yet".
  const [loadError, setLoadError] = useState<string | null>(null);
  // Save errors of the preview/edit modals, shown inside them.
  const [planEditError, setPlanEditError] = useState<string | null>(null);
  const [productEditError, setProductEditError] = useState<string | null>(null);
  // Totals are shown in the app's default currency (Settings).
  const [currency, setCurrency] = useState('PLN');

  const [editingPlan, setEditingPlan] = useState<Partial<ProductionPlan> | null>(null);
  const [planModalReadOnly, setPlanModalReadOnly] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [productModalReadOnly, setProductModalReadOnly] = useState(false);

  const reload = async (): Promise<string[]> => {
    const [ps, pr, rm, cs, settings] = await Promise.all([
      window.electronAPI.listPlans(),
      window.electronAPI.listProducts(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
      window.electronAPI.getSettings(),
    ]);
    setCurrency(settings.defaultCurrency || 'PLN');
    setPlans(ps);
    setProducts(pr);
    setRawMaterials(rm);
    setComponents(cs);
    const existingIds = new Set(ps.map((p) => p.id));
    const filteredPlanIds = planIds.filter((id) => existingIds.has(id));
    setPlanIds(filteredPlanIds);
    setReports((prev) => prev.filter((r) => existingIds.has(r.planId)));
    setExpandedIds((prev) => prev.filter((id) => existingIds.has(id)));
    return filteredPlanIds;
  };

  useEffect(() => {
    void (async () => {
      // Entering the view: load the lists and refresh the remembered
      // selection quietly — previous results stay on screen and the banner's
      // refresh icon spins; no blocking overlay.
      setInitialLoading(true);
      setLoadError(null);
      quietRef.current = true;
      // The catalog load and the recompute of the remembered selection run in
      // parallel; a plan deleted meanwhile just drops out of the results.
      const remembered = planIds;
      try {
        const [listed] = await Promise.allSettled([
          reload(),
          remembered.length > 0 ? compute(remembered, { skipFailed: true }) : Promise.resolve(),
        ]);
        if (listed.status === 'rejected') {
          setLoadError(`${t.loadFailed}: ${errorMessage(listed.reason)}`);
        }
      } finally {
        quietRef.current = false;
        setInitialLoading(false);
      }
    })();
  }, []);

  const openPlanPreview = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    setPlanEditError(null);
    setEditingPlan({ ...plan });
    setPlanModalReadOnly(true);
  };
  const closePlanModal = () => {
    setEditingPlan(null);
    setPlanModalReadOnly(false);
  };
  const savePlan = async () => {
    if (!editingPlan?.id || !editingPlan.name?.trim()) return;
    setPlanEditError(null);
    try {
      await window.electronAPI.updatePlan(editingPlan.id, {
        name: editingPlan.name.trim(),
        items: editingPlan.items ?? [],
        bulkMass: editingPlan.bulkMass ?? [],
        status: editingPlan.status ?? 'draft',
      });
      closePlanModal();
      await reload();
    } catch (err) {
      setPlanEditError(errorMessage(err));
    }
  };

  const openProductPreview = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    setProductEditError(null);
    setEditingProduct({ ...p });
    setProductModalReadOnly(true);
  };
  const closeProductModal = () => {
    setEditingProduct(null);
    setProductModalReadOnly(false);
  };
  const saveProduct = async () => {
    if (!editingProduct?.id || !editingProduct.name?.trim()) return;
    setProductEditError(null);
    try {
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
    } catch (err) {
      setProductEditError(errorMessage(err));
    }
  };

  useEffect(() => {
    saveState({ planIds, reports, expandedIds, expandedItemKeys });
  }, [planIds, reports, expandedIds, expandedItemKeys]);

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

  const itemKey = (planId: string, productId: string) => `${planId}:${productId}`;

  const toggleItems = (planId: string, productId: string) => {
    const key = itemKey(planId, productId);
    setExpandedItemKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  // Current catalog price history for a cost line. Read live from the catalog
  // rather than from the (persisted, possibly stale) report.
  const historyFor = (line: CostItemLine): PriceHistoryEntry[] | undefined =>
    line.kind === 'raw'
      ? rawMaterials.find((r) => r.id === line.itemId)?.priceHistory
      : components.find((c) => c.id === line.itemId)?.priceHistory;

  // Saves a price straight into the raw materials / components catalog, then
  // reloads and recomputes so every number on screen reflects the new price.
  const setItemPrice = async (line: CostItemLine, price: number | undefined) => {
    setError(null);
    try {
      if (line.kind === 'raw') {
        await window.electronAPI.updateRawMaterial(line.itemId, {
          lastPurchasePriceNet: price,
        });
      } else {
        await window.electronAPI.updateComponent(line.itemId, {
          lastPurchasePriceNet: price,
        });
      }
      await reload();
      await compute();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // `skipFailed`: the entry refresh runs before the plan list is back, so a
  // remembered plan may no longer exist — keep the reports that did compute
  // instead of failing the whole batch.
  const compute = async (ids?: string[], opts?: { skipFailed?: boolean }) => {
    const targetIds = ids ?? planIds;
    if (targetIds.length === 0) return;
    setBusy(true);
    if (!quietRef.current) setLoaderMessage(t.loaderComputing);
    setError(null);
    try {
      if (opts?.skipFailed) {
        const settled = await Promise.allSettled(
          targetIds.map((id) => window.electronAPI.computeCost(id)),
        );
        setReports(
          settled
            .filter((r): r is PromiseFulfilledResult<CostReport> => r.status === 'fulfilled')
            .map((r) => r.value),
        );
      } else {
        const next = await Promise.all(
          targetIds.map((id) => window.electronAPI.computeCost(id)),
        );
        setReports(next);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Consumption per unit spans grams (50) and fractions of a carton (0.0417),
  // so keep enough precision for the small end without padding the large one.
  const fmtQty = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: n < 1 ? 4 : 2 });

  const KIND_LABEL: Record<CostItemKind, string> = {
    raw: t.ingredients,
    component: t.packaging,
    bulkPackaging: t.bulkPackagingCost,
  };
  const KIND_ORDER: CostItemKind[] = ['raw', 'component', 'bulkPackaging'];

  // One drill-down table of catalog items — shared by finished products
  // (amounts per 1 unit) and bulk-mass positions (amounts per 1 kg).
  const renderCostItems = (
    items: CostItemLine[],
    labels: { hint: string; qty: string; cost: string },
  ) => (
    <div className="cost-items">
      <div className="cost-items-title">{t.costItems}</div>
      <div className="cost-items-hint">
        {labels.hint} {t.costItemsOverageNote}
      </div>
      <table className="table cost-items-table">
        <thead>
          <tr>
            <th>{t.name}</th>
            <th className="num">{labels.qty}</th>
            <th className="num">{t.costItemUnitPrice}</th>
            <th className="num">{labels.cost}</th>
          </tr>
        </thead>
        <tbody>
          {KIND_ORDER.filter((kind) => items.some((it) => it.kind === kind)).map((kind) => (
            <React.Fragment key={kind}>
              <tr className="cost-items-group">
                <td colSpan={4}>{KIND_LABEL[kind]}</td>
              </tr>
              {items
                .filter((it) => it.kind === kind)
                .map((it) => (
                  <tr key={`${it.kind}-${it.itemId}`}>
                    <td className="col-wrap">
                      {it.itemName}
                      {it.factorySupplied && (
                        <span className="tag cost-item-tag">{t.factorySupplied}</span>
                      )}
                      {it.viaDependency && (
                        <span className="tag cost-item-tag">{t.costItemViaDependency}</span>
                      )}
                    </td>
                    <td className="num">
                      {fmtQty(it.qtyPerUnit)} {it.qtyUnit}
                    </td>
                    <PriceCell
                      price={it.unitPrice}
                      currency={it.currency}
                      history={historyFor(it)}
                      priceUnit={it.priceUnit}
                      onCommit={(v) => setItemPrice(it, v)}
                    />
                    <td className="num">
                      {it.unitPrice === undefined ? (
                        <span className="tag warn">{t.costItemNoPrice}</span>
                      ) : (
                        fmt(it.cost)
                      )}
                    </td>
                  </tr>
                ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderMissingPrices = (
    missing: { itemId: string; itemName: string; kind: 'raw' | 'component' }[],
  ) =>
    missing.length === 0 ? (
      <HoverTooltip align="right" trigger={<span className="tag success">✓</span>}>
        <div className="shortage-tooltip-explain">{t.missingPricesAllPriced}</div>
      </HoverTooltip>
    ) : (
      <HoverTooltip align="right" trigger={<span className="tag warn">{missing.length}</span>}>
        <div className="shortage-tooltip-header">
          {t.missingPricesTooltipHeader} — {missing.length}
        </div>
        <div className="shortage-tooltip-explain">{t.missingPricesTooltipExplain}</div>
        <ul className="shortage-tooltip-list">
          {missing.map((m) => (
            <li key={`${m.kind}-${m.itemId}`}>
              <span className="shortage-tooltip-name">{m.itemName}</span>
              <span className="tag">{m.kind === 'raw' ? t.rawMaterials : t.components}</span>
            </li>
          ))}
        </ul>
      </HoverTooltip>
    );

  if (!initialLoading && loadError) {
    return (
      <div className="main">
        <div className="page-header">
          <HeaderNav />
          <h1>{t.costCalculator}</h1>
        </div>
        <div className="card">
          <div className="error-text">{loadError}</div>
        </div>
      </div>
    );
  }

  if (!initialLoading && plans.length === 0) {
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
        <span className="compute-hero-icon" aria-hidden>{VIEW_ICONS.costCalculator}</span>
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
            {/* Re-run with the same selection — lives in the banner next to
                the main action once there are results. */}
            {reports.length > 0 && (
              <button
                type="button"
                className="btn compute-hero-secondary"
                onClick={() => compute()}
                disabled={busy || planIds.length === 0}
              >
                <IconRefresh size={15} className={busy ? 'spinning' : undefined} />
                <span>{t.maxProducibleRefresh}</span>
              </button>
            )}
            <button
              className="compute-hero-cta"
              disabled={planIds.length === 0 || busy}
              onClick={() => compute()}
            >
              {busy ? t.loading : t.computeCost} →
            </button>
          </div>
          {error && <div className="compute-hero-error">{error}</div>}
        </div>
      </div>

      {reports.map((report) => {
        const planName = planNameById.get(report.planId) ?? '—';
        const productCount = report.perProduct.length;
        // Reports persisted by an older version may lack these fields.
        const bulkLines = report.bulkMass ?? [];
        const warnings = report.warnings ?? [];
        const totalMissing =
          report.perProduct.reduce((acc, line) => acc + line.missingPriceItems.length, 0) +
          bulkLines.reduce((acc, line) => acc + line.missingPriceItems.length, 0);
        const isExpanded = expandedIds.includes(report.planId);
        const hasDetails = productCount > 0 || bulkLines.length > 0;

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
              <HoverTooltip
                className="hover-tooltip-compact"
                trigger={
                  <button
                    type="button"
                    className="link-button maxprod-product"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      openPlanPreview(report.planId);
                    }}
                  >
                    {planName}
                  </button>
                }
              >
                {t.openPlan}
              </HoverTooltip>
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
                <span className="maxprod-hero-unit">{currency}</span>
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
                  <div className="shortage-tooltip-explain">{t.missingPricesTooltipExplain}</div>
                </HoverTooltip>
              )}
            </div>

            {warnings.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className="warn-text" style={{ fontWeight: 600, marginBottom: 4 }}>
                  {t.calcWarningsTitle}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                  {warnings.map((w, i) => (
                    <li key={i} className="hint">
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {hasDetails && isExpanded && (
              <div className="maxprod-details" onClick={(e) => e.stopPropagation()}>
                {productCount > 0 && (
                <>
                <div className="maxprod-details-header">{t.unitCost}</div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t.products}</th>
                        <th className="num">{t.unitCost}</th>
                        <th className="num">{t.ingredients}</th>
                        <th className="num">{t.packaging}</th>
                        <th className="num">{t.bulkPackagingCost}</th>
                        <th className="num">{t.laborCost}</th>
                        <th>{t.missingPrices}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.perProduct.map((line) => {
                        const itemsOpen = expandedItemKeys.includes(
                          itemKey(report.planId, line.productId),
                        );
                        const hasItems = (line.items ?? []).length > 0;
                        return (
                          <React.Fragment key={line.productId}>
                            {/* The whole row toggles the cost breakdown; the
                                product link inside still opens the preview. */}
                            <tr
                              className={hasItems ? 'row-clickable' : undefined}
                              onClick={
                                hasItems
                                  ? () => toggleItems(report.planId, line.productId)
                                  : undefined
                              }
                            >
                              <td>
                                <div className="cost-product-cell">
                                  {hasItems && (
                                    <IconButton
                                      align="left"
                                      style={{ minWidth: 0 }}
                                      className={`btn-sm cost-items-toggle${
                                        itemsOpen ? ' is-open' : ''
                                      }`}
                                      icon={<IconChevronDown size={13} />}
                                      label={itemsOpen ? t.maxProducibleHideDetails : t.costItems}
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        toggleItems(report.planId, line.productId);
                                      }}
                                    />
                                  )}
                                  <HoverTooltip
                                    className="hover-tooltip-compact"
                                    trigger={
                                      <button
                                        type="button"
                                        className="link-button"
                                        onClick={(ev) => {
                                          ev.stopPropagation();
                                          openProductPreview(line.productId);
                                        }}
                                      >
                                        {line.productName}
                                      </button>
                                    }
                                  >
                                    {t.preview}
                                  </HoverTooltip>
                                </div>
                              </td>
                              <td className="num">
                                <strong>{fmt(line.unitCost)}</strong>
                              </td>
                              <td className="num">{fmt(line.ingredientsCost)}</td>
                              <td className="num">{fmt(line.packagingCost)}</td>
                              <td className="num">{fmt(line.bulkPackagingCost ?? 0)}</td>
                              <td className="num">{fmt(line.laborCost)}</td>
                              <td>{renderMissingPrices(line.missingPriceItems)}</td>
                            </tr>
                            {hasItems && itemsOpen && (
                              <tr className="cost-items-row">
                                <td colSpan={7}>
                                  {renderCostItems(line.items, {
                                    hint: t.costItemsHint,
                                    qty: t.costItemQty,
                                    cost: t.costItemCost,
                                  })}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                </>
                )}

                {bulkLines.length > 0 && (
                  <>
                    <div className="maxprod-details-header" style={{ marginTop: 12 }}>
                      {t.bulkMass}
                    </div>
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>{t.products}</th>
                            <th className="num">{t.costBulkMassKg}</th>
                            <th className="num">{t.costPerKg}</th>
                            <th className="num">{t.ingredients}</th>
                            <th className="num">{t.bulkPackagingCost}</th>
                            <th className="num">{t.costBulkTotal}</th>
                            <th>{t.missingPrices}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkLines.map((line, idx) => {
                            const key = `bulk:${idx}:${line.productId}`;
                            const itemsOpen = expandedItemKeys.includes(
                              itemKey(report.planId, key),
                            );
                            const hasItems = (line.items ?? []).length > 0;
                            return (
                              <React.Fragment key={key}>
                                <tr
                                  className={hasItems ? 'row-clickable' : undefined}
                                  onClick={
                                    hasItems ? () => toggleItems(report.planId, key) : undefined
                                  }
                                >
                                  <td>
                                    <div className="cost-product-cell">
                                      {hasItems && (
                                        <IconButton
                                          align="left"
                                          style={{ minWidth: 0 }}
                                          className={`btn-sm cost-items-toggle${
                                            itemsOpen ? ' is-open' : ''
                                          }`}
                                          icon={<IconChevronDown size={13} />}
                                          label={
                                            itemsOpen ? t.maxProducibleHideDetails : t.costItems
                                          }
                                          onClick={(ev) => {
                                            ev.stopPropagation();
                                            toggleItems(report.planId, key);
                                          }}
                                        />
                                      )}
                                      <HoverTooltip
                                        className="hover-tooltip-compact"
                                        trigger={
                                          <button
                                            type="button"
                                            className="link-button"
                                            onClick={(ev) => {
                                              ev.stopPropagation();
                                              openProductPreview(line.productId);
                                            }}
                                          >
                                            {line.productName}
                                          </button>
                                        }
                                      >
                                        {t.preview}
                                      </HoverTooltip>
                                    </div>
                                  </td>
                                  <td className="num">{fmtQty(line.massKg)}</td>
                                  <td className="num">
                                    <strong>{fmt(line.costPerKg)}</strong>
                                  </td>
                                  <td className="num">{fmt(line.ingredientsCostPerKg)}</td>
                                  <td className="num">{fmt(line.bulkPackagingCostPerKg)}</td>
                                  <td className="num">{fmt(line.totalCost)}</td>
                                  <td>{renderMissingPrices(line.missingPriceItems)}</td>
                                </tr>
                                {hasItems && itemsOpen && (
                                  <tr className="cost-items-row">
                                    <td colSpan={7}>
                                      {renderCostItems(line.items, {
                                        hint: t.costBulkItemsHint,
                                        qty: t.costItemQtyPerKg,
                                        cost: t.costPerKg,
                                      })}
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
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
          error={planEditError}
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
          error={productEditError}
          readOnly={productModalReadOnly}
          onEnterEdit={() => setProductModalReadOnly(false)}
        />
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

export default CostCalculatorView;
