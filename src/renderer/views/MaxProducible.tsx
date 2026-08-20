import React, { useEffect, useMemo, useState } from 'react';
import { useT, useLang } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  Product,
  MaxProducibleResult,
  RawMaterial,
  PackagingComponent,
  ExpiredBatchRef,
  DependencyShortageRef,
} from '../../shared/types';
import MultiSelect from '../components/MultiSelect';
import LoadingOverlay from '../components/LoadingOverlay';
import ProductEditorModal from '../components/ProductEditorModal';
import ExpiredStockModal from '../components/ExpiredStockModal';
import DependencyShortageModal, {
  buildSubstituteCandidates,
} from '../components/DependencyShortageModal';
import { IconRefresh, IconChevronDown } from '../components/Icons';

type Bottleneck = MaxProducibleResult['bottlenecks'][number];

// Persisted state: keeps the user's selection, computed results, and expanded
// cards alive across view-switches AND app restarts. The MaxProducible view
// is conditionally rendered in App.tsx and unmounts on navigation, so React
// state alone would reset on return; localStorage carries it through to the
// next session as well. On entry the view auto-recomputes against current
// stock, so the persisted results just render as a placeholder while the
// fresh compute runs — they cannot linger as stale numbers.
const STORAGE_KEY = 'cutis.maxProducible.state';

interface PersistedState {
  productIds: string[];
  results: MaxProducibleResult[];
  expandedIds: string[];
}

const EMPTY_STATE: PersistedState = { productIds: [], results: [], expandedIds: [] };

const loadState = (): PersistedState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_STATE;
    const productIds = Array.isArray(parsed.productIds)
      ? parsed.productIds.filter((x: unknown): x is string => typeof x === 'string')
      : [];
    const results = Array.isArray(parsed.results) ? (parsed.results as MaxProducibleResult[]) : [];
    const expandedIds = Array.isArray(parsed.expandedIds)
      ? parsed.expandedIds.filter((x: unknown): x is string => typeof x === 'string')
      : [];
    return { productIds, results, expandedIds };
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

const fmtRaw = (kg: number): string => {
  if (kg <= 0) return '0';
  if (kg < 1) {
    const g = kg * 1000;
    return `${g < 1 ? g.toFixed(2) : g.toFixed(1)} g`;
  }
  return `${kg.toFixed(2)} kg`;
};

const fmtComp = (n: number): string => {
  if (n <= 0) return '0';
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2);
};

const fmtAmount = (b: Bottleneck, unitsShort: string): string =>
  b.kind === 'raw' ? fmtRaw(b.available) : `${fmtComp(b.available)} ${unitsShort}`;

const fmtPerUnit = (b: Bottleneck, unitsShort: string): string =>
  b.kind === 'raw' ? fmtRaw(b.needPerUnit) : `${fmtComp(b.needPerUnit)} ${unitsShort}`;

const MaxProducibleView: React.FC = () => {
  const t = useT();
  const lang = useLang();
  const locale = lang === 'pl' ? 'pl-PL' : 'en-US';
  const [products, setProducts] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [productIds, setProductIds] = useState<string[]>(() => loadState().productIds);
  const [results, setResults] = useState<MaxProducibleResult[]>(() => loadState().results);
  const [expandedIds, setExpandedIds] = useState<string[]>(() => loadState().expandedIds);
  const [busy, setBusy] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  // Expired-stock gate for the production calculator: after the first
  // (expired-excluded) pass, if any ingredient has expired batches the user
  // decides per-run which to count; `base` holds that first pass for cancel.
  const [pendingExpired, setPendingExpired] = useState<
    { batches: ExpiredBatchRef[]; targetIds: string[]; base: MaxProducibleResult[] } | null
  >(null);
  // "Zużywa"-shortage gate: cascade-consumed components (tape via carton)
  // that cap production below every non-cascade limit. The user decides
  // per-run whether to accept each shortage (a substitute exists — exclude it
  // from the calculation) or keep it as the limiting bottleneck. `computed`
  // holds the results of the pass that surfaced the prompt, for cancel.
  const [pendingDeps, setPendingDeps] = useState<{
    refs: DependencyShortageRef[];
    targetIds: string[];
    expiredIds: string[];
    computed: MaxProducibleResult[];
  } | null>(null);
  // Remembers the accepted shortages / substitutions so the expired-panel
  // regenerate keeps the same decision instead of re-prompting.
  const [acceptedDepIds, setAcceptedDepIds] = useState<string[]>([]);
  const [depSubstitutions, setDepSubstitutions] = useState<Record<string, string>>({});
  // Editable copy of the "count this expired batch?" decision, shown as a panel
  // over the results so the user can change it and recompute — mirrors the
  // shortage report. Re-seeded from the results' own `included` flags.
  const [expiredDraft, setExpiredDraft] = useState<Set<string>>(new Set());

  // Expired batches across all current results, deduped by batch id.
  const expiredBatches = useMemo(() => {
    const byId = new Map<string, ExpiredBatchRef>();
    for (const r of results) for (const b of r.expiredBatches ?? []) byId.set(b.batchId, b);
    return Array.from(byId.values());
  }, [results]);

  // Re-seed the draft whenever the results change (a fresh compute).
  useEffect(() => {
    setExpiredDraft(new Set(expiredBatches.filter((b) => b.included).map((b) => b.batchId)));
  }, [expiredBatches]);

  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [productModalReadOnly, setProductModalReadOnly] = useState(false);

  const reload = async (): Promise<string[]> => {
    const [ps, rm, cs] = await Promise.all([
      window.electronAPI.listProducts(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
    ]);
    setProducts(ps);
    setRawMaterials(rm);
    setComponents(cs);
    const existingIds = new Set(ps.map((p) => p.id));
    const filteredProductIds = productIds.filter((id) => existingIds.has(id));
    setProductIds(filteredProductIds);
    setResults((prev) => prev.filter((r) => existingIds.has(r.productId)));
    setExpandedIds((prev) => prev.filter((id) => existingIds.has(id)));
    return filteredProductIds;
  };

  useEffect(() => {
    void (async () => {
      setLoaderMessage(t.loading);
      try {
        const filteredIds = await reload();
        if (filteredIds.length > 0) {
          await compute(filteredIds);
        }
      } finally {
        setLoaderMessage(null);
      }
    })();
  }, []);

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
    saveState({ productIds, results, expandedIds });
  }, [productIds, results, expandedIds]);

  const toggleExpanded = (productId: string) => {
    setExpandedIds((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId],
    );
  };

  const runCompute = async (
    targetIds: string[],
    includeExpiredBatchIds: string[],
    acceptedDependencyIds: string[] = [],
    substitutions: Record<string, string> = {},
  ): Promise<MaxProducibleResult[]> => {
    setBusy(true);
    setLoaderMessage(t.loaderComputing);
    try {
      return await Promise.all(
        targetIds.map((id) =>
          window.electronAPI.maxProducible(
            id,
            includeExpiredBatchIds,
            acceptedDependencyIds,
            substitutions,
          ),
        ),
      );
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  // Last gate before showing results: if any "zużywa"-cascade component caps
  // production, ask the user (accept shortage → substitute used, excluded)
  // before committing the results.
  const finishWithDepGate = (
    targetIds: string[],
    expiredIds: string[],
    computed: MaxProducibleResult[],
  ) => {
    const byId = new Map<string, DependencyShortageRef>();
    for (const r of computed) {
      for (const d of r.dependencyShortages ?? []) {
        if (!d.accepted) byId.set(d.componentId, d);
      }
    }
    const refs = Array.from(byId.values());
    if (refs.length > 0) {
      setPendingDeps({ refs, targetIds, expiredIds, computed });
      return;
    }
    setResults(computed);
  };

  const compute = async (ids?: string[]) => {
    const targetIds = ids ?? productIds;
    if (targetIds.length === 0) return;
    // Fresh run — every per-run decision is asked again.
    setAcceptedDepIds([]);
    setDepSubstitutions({});
    // First pass excludes all expired stock. If any expired batch is
    // relevant, gate on the per-run decision before showing results.
    const base = await runCompute(targetIds, []);
    const byId = new Map<string, ExpiredBatchRef>();
    for (const r of base) for (const b of r.expiredBatches ?? []) byId.set(b.batchId, b);
    const expired = Array.from(byId.values());
    if (expired.length > 0) {
      setPendingExpired({ batches: expired, targetIds, base });
      return;
    }
    finishWithDepGate(targetIds, [], base);
  };

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.maxProducible}</h1>
      </div>

      <div className="compute-hero">
        <span className="compute-hero-icon" aria-hidden>
          📦
        </span>
        <div className="compute-hero-text">
          <span className="compute-hero-title">{t.maxProducible}</span>
          <span className="compute-hero-hint">{t.maxProducibleHeroHint}</span>
          <div className="compute-hero-controls">
            <MultiSelect
              options={products.map((p) => ({ value: p.id, label: p.name }))}
              selected={productIds}
              onChange={setProductIds}
              placeholder={t.maxProducibleSelectProducts}
              selectAllLabel={t.maxProducibleSelectAll}
              clearLabel={t.maxProducibleClearSelection}
              selectedCountLabel={t.maxProducibleSelectedCount}
            />
            <button
              className="compute-hero-cta"
              disabled={productIds.length === 0 || busy}
              onClick={() => compute()}
            >
              {busy ? t.loading : t.compute} →
            </button>
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="maxprod-results-header">
          <button
            type="button"
            className="btn primary-filled maxprod-refresh-btn"
            onClick={() => compute()}
            disabled={busy || productIds.length === 0}
            title={t.maxProducibleRefresh}
          >
            <IconRefresh size={16} className={busy ? 'spinning' : undefined} />
            <span>{t.maxProducibleRefresh}</span>
          </button>
        </div>
      )}

      {expiredBatches.length > 0 && (
        <div className="card expired-report-panel">
          <strong className="warn-text">{t.expiredStockTitle}</strong>
          <div className="hint" style={{ margin: '4px 0 10px' }}>
            {t.expiredReportPanelHint}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.name}</th>
                  <th className="num">{t.stock}</th>
                  <th>{t.expiry}</th>
                  <th>{t.expiredStockInclude}</th>
                </tr>
              </thead>
              <tbody>
                {expiredBatches.map((b) => {
                  const on = expiredDraft.has(b.batchId);
                  const retested =
                    !!b.effectiveExpiry && b.effectiveExpiry !== b.originalExpiry;
                  return (
                    <tr key={b.batchId}>
                      <td className="col-wrap">
                        {b.rawMaterialName}
                        {b.note && <div className="hint">{b.note}</div>}
                      </td>
                      <td className="num">
                        {b.qty.toLocaleString(locale)} {b.unit}
                      </td>
                      <td>
                        <span className="stock-batch-flag">
                          {b.effectiveExpiry
                            ? new Date(b.effectiveExpiry).toLocaleDateString(locale)
                            : '—'}
                        </span>
                        {retested && (
                          <div className="hint">
                            {t.expiryOriginal}:{' '}
                            {b.originalExpiry
                              ? new Date(b.originalExpiry).toLocaleDateString(locale)
                              : '—'}
                          </div>
                        )}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setExpiredDraft((prev) => {
                              const next = new Set(prev);
                              if (next.has(b.batchId)) next.delete(b.batchId);
                              else next.add(b.batchId);
                              return next;
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <div className="spacer" />
            <button
              className="btn primary-filled"
              disabled={busy || productIds.length === 0}
              onClick={() =>
                void runCompute(productIds, [...expiredDraft], acceptedDepIds, depSubstitutions).then(
                  setResults,
                )
              }
              title={t.expiredReportRegenerate}
            >
              {t.expiredReportRegenerate}
            </button>
          </div>
        </div>
      )}

      {results.map((result) => {
        const noBottlenecks = result.bottlenecks.length === 0;
        const limiters = result.bottlenecks.filter((b) => b.maxUnits === result.units);
        const isZero = result.units === 0;
        const isExpanded = expandedIds.includes(result.productId);
        const hasDetails = result.bottlenecks.length > 0;

        return (
          <div
            key={result.productId}
            className={`card maxprod-result${isZero ? ' is-zero' : ''}${
              hasDetails ? ' is-clickable' : ''
            }${isExpanded ? ' is-expanded' : ''}`}
            onClick={hasDetails ? () => toggleExpanded(result.productId) : undefined}
            role={hasDetails ? 'button' : undefined}
            tabIndex={hasDetails ? 0 : undefined}
            onKeyDown={
              hasDetails
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpanded(result.productId);
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
                  openProductPreview(result.productId);
                }}
                title={t.preview}
              >
                {result.productName}
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
              <div className="maxprod-hero-label">{t.maxProducibleHero}</div>
              <div className="maxprod-hero-value">
                <span className="maxprod-hero-num">{result.units.toLocaleString(locale)}</span>
                <span className="maxprod-hero-unit">{t.unitsShort}</span>
              </div>
            </div>

            {noBottlenecks ? (
              <div className="maxprod-status">
                {result.units === 0 ? t.maxProducibleEmptyRecipe : t.maxProducibleNoLimit}
              </div>
            ) : (
              <div className="maxprod-limiter">
                <div className="maxprod-limiter-label">
                  {isZero ? t.maxProducibleZeroStock : `${t.maxProducibleLimitedBy}:`}
                </div>
                {limiters.map((b) => (
                  <div key={`${b.kind}-${b.itemId}`} className="maxprod-limiter-item">
                    <div className="maxprod-limiter-name">
                      <strong>{b.itemName}</strong>
                      <span className="tag">
                        {b.kind === 'raw' ? t.rawMaterials : t.components}
                      </span>
                      {b.nextExpiry && (
                        <span className="maxprod-expiry">
                          {t.expiry}: {new Date(b.nextExpiry).toLocaleDateString(locale)}
                        </span>
                      )}
                      {b.expiredExcludedQty ? (
                        <span className="maxprod-expiry stock-batch-flag">
                          {t.maxProducibleExpiredExcluded.replace(
                            '{n}',
                            b.expiredExcludedQty.toLocaleString(locale),
                          )}
                        </span>
                      ) : null}
                    </div>
                    <div className="maxprod-stats">
                      <div className="maxprod-stat">
                        <div className="maxprod-stat-label">{t.available}</div>
                        <div className="maxprod-stat-value">{fmtAmount(b, t.unitsShort)}</div>
                      </div>
                      <div className="maxprod-stat">
                        <div className="maxprod-stat-label">{t.perUnitLabel}</div>
                        <div className="maxprod-stat-value">{fmtPerUnit(b, t.unitsShort)}</div>
                      </div>
                      <div className="maxprod-stat is-result">
                        <div className="maxprod-stat-label">{t.enoughFor}</div>
                        <div className="maxprod-stat-value">
                          {b.maxUnits.toLocaleString(locale)}{' '}
                          <span className="maxprod-stat-unit">{t.unitsShort}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {hasDetails && isExpanded && (
              <div
                className="maxprod-details"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="maxprod-details-header">{t.maxProducibleWhyHeader}</div>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{t.name}</th>
                        <th></th>
                        <th className="num">{t.available}</th>
                        <th>{t.expiry}</th>
                        <th className="num">{t.perUnitLabel}</th>
                        <th className="num">{t.enoughFor}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.bottlenecks.map((b) => {
                        const isLimiter = b.maxUnits === result.units;
                        return (
                          <tr
                            key={`${b.kind}-${b.itemId}`}
                            className={isLimiter ? 'maxprod-details-limiter' : undefined}
                          >
                            <td>
                              <strong>{b.itemName}</strong>
                            </td>
                            <td>
                              <span className="tag">
                                {b.kind === 'raw' ? t.rawMaterials : t.components}
                              </span>
                            </td>
                            <td className="num">{fmtAmount(b, t.unitsShort)}</td>
                            <td>
                              {b.nextExpiry
                                ? new Date(b.nextExpiry).toLocaleDateString(locale)
                                : '—'}
                              {b.expiredExcludedQty ? (
                                <div className="hint stock-batch-flag">
                                  {t.maxProducibleExpiredExcluded.replace(
                                    '{n}',
                                    b.expiredExcludedQty.toLocaleString(locale),
                                  )}
                                </div>
                              ) : null}
                            </td>
                            <td className="num">{fmtPerUnit(b, t.unitsShort)}</td>
                            <td className="num">
                              <strong>{b.maxUnits.toLocaleString(locale)}</strong>{' '}
                              {t.unitsShort}
                            </td>
                            <td>
                              {isLimiter && (
                                <span className="tag danger">{t.bottleneckTag}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}

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

      {pendingExpired && (
        <ExpiredStockModal
          batches={pendingExpired.batches}
          onCancel={() => {
            // Cancel = keep the expired-excluded first pass.
            setResults(pendingExpired.base);
            setPendingExpired(null);
          }}
          onConfirm={(ids) => {
            const { targetIds, base } = pendingExpired;
            setPendingExpired(null);
            if (ids.length === 0) finishWithDepGate(targetIds, [], base);
            else
              void runCompute(targetIds, ids).then((next) =>
                finishWithDepGate(targetIds, ids, next),
              );
          }}
        />
      )}

      {pendingDeps && (
        <DependencyShortageModal
          rows={pendingDeps.refs.map((r) => ({
            componentId: r.componentId,
            name: r.componentName,
            consumedBy: r.consumedBy,
            detail: t.depShortageDetailMax
              .replace('{available}', r.available.toLocaleString())
              .replace('{maxUnits}', (r.maxUnits ?? 0).toLocaleString()),
            candidates: buildSubstituteCandidates(components, r.componentId),
          }))}
          onCancel={() => {
            // Cancel = keep the results with every shortage counted.
            setResults(pendingDeps.computed);
            setPendingDeps(null);
          }}
          onConfirm={({ acceptedIds, substitutions }) => {
            const { targetIds, expiredIds, computed } = pendingDeps;
            setPendingDeps(null);
            setAcceptedDepIds(acceptedIds);
            setDepSubstitutions(substitutions);
            if (acceptedIds.length === 0 && Object.keys(substitutions).length === 0) {
              setResults(computed);
            } else {
              void runCompute(targetIds, expiredIds, acceptedIds, substitutions).then(setResults);
            }
          }}
        />
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

export default MaxProducibleView;
