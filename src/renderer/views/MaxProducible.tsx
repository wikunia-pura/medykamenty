import React, { useEffect, useState } from 'react';
import { useT, useLang } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  Product,
  MaxProducibleResult,
  RawMaterial,
  PackagingComponent,
} from '../../shared/types';
import MultiSelect from '../components/MultiSelect';
import ProductEditorModal from '../components/ProductEditorModal';
import { IconRefresh, IconChevronDown } from '../components/Icons';

type Bottleneck = MaxProducibleResult['bottlenecks'][number];

// Persisted state: keeps the user's selection, computed results, and expanded
// cards alive across view-switches AND app restarts. The MaxProducible view
// is conditionally rendered in App.tsx and unmounts on navigation, so React
// state alone would reset on return; localStorage carries it through to the
// next session as well. Stale results are acceptable here because the
// prominent Refresh button lets the user recompute on demand.
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

  const [editingProduct, setEditingProduct] = useState<Partial<Product> | null>(null);
  const [productModalReadOnly, setProductModalReadOnly] = useState(false);

  const reload = async () => {
    const [ps, rm, cs] = await Promise.all([
      window.electronAPI.listProducts(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
    ]);
    setProducts(ps);
    setRawMaterials(rm);
    setComponents(cs);
  };

  useEffect(() => {
    void reload();
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

  const compute = async () => {
    if (productIds.length === 0) return;
    setBusy(true);
    try {
      const next = await Promise.all(
        productIds.map((id) => window.electronAPI.maxProducible(id)),
      );
      setResults(next);
    } finally {
      setBusy(false);
    }
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
              onClick={compute}
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
            onClick={compute}
            disabled={busy || productIds.length === 0}
            title={t.maxProducibleRefresh}
          >
            <IconRefresh size={16} className={busy ? 'spinning' : undefined} />
            <span>{t.maxProducibleRefresh}</span>
          </button>
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
    </div>
  );
};

export default MaxProducibleView;
