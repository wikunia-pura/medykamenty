import React, { useEffect, useState } from 'react';
import { useT, useLang } from '../i18n';
import type { Product, MaxProducibleResult } from '../../shared/types';

type Bottleneck = MaxProducibleResult['bottlenecks'][number];

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
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<string>('');
  const [result, setResult] = useState<MaxProducibleResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const ps = await window.electronAPI.listProducts();
      setProducts(ps);
      if (ps[0]) setProductId(ps[0].id);
    })();
  }, []);

  const compute = async () => {
    if (!productId) return;
    setBusy(true);
    try {
      const r = await window.electronAPI.maxProducible(productId);
      setResult(r);
    } finally {
      setBusy(false);
    }
  };

  const locale = lang === 'pl' ? 'pl-PL' : 'en-US';
  const noBottlenecks = result && result.bottlenecks.length === 0;
  const limiters = result
    ? result.bottlenecks.filter((b) => b.maxUnits === result.units)
    : [];
  const isZero = result?.units === 0;

  return (
    <div className="main">
      <h1>{t.maxProducible}</h1>

      <div className="card">
        <div className="row">
          <select value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">—</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!productId || busy} onClick={compute}>
            {busy ? t.loading : t.compute}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div
            className="card"
            style={{
              borderColor: isZero ? 'var(--danger)' : 'var(--primary)',
              borderWidth: 2,
            }}
          >
            <div className="hint">{result.productName}</div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span className="hint">{t.maxProducibleHero}</span>
              <span
                style={{
                  fontSize: 48,
                  fontWeight: 700,
                  lineHeight: 1,
                  color: isZero ? 'var(--danger)' : 'var(--primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {result.units.toLocaleString(locale)}
              </span>
              <span className="hint" style={{ fontSize: 18 }}>{t.unitsShort}</span>
            </div>

            {noBottlenecks ? (
              <div className="hint" style={{ marginTop: 12 }}>
                {result.bottlenecks.length === 0 && result.units === 0
                  ? t.maxProducibleEmptyRecipe
                  : t.maxProducibleNoLimit}
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <div className="hint" style={{ marginBottom: 4 }}>
                  {isZero ? t.maxProducibleZeroStock : `${t.maxProducibleLimitedBy}:`}
                </div>
                {limiters.map((b) => (
                  <div key={`${b.kind}-${b.itemId}`} style={{ marginTop: 4 }}>
                    <strong>{b.itemName}</strong>{' '}
                    <span className="tag">{b.kind === 'raw' ? t.rawMaterials : t.components}</span>
                    <div className="hint" style={{ marginTop: 2 }}>
                      {t.available}: {fmtAmount(b, t.unitsShort)} · {t.perUnitLabel}: {fmtPerUnit(b, t.unitsShort)} · {t.enoughFor}:{' '}
                      <strong>{b.maxUnits.toLocaleString(locale)} {t.unitsShort}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {result.bottlenecks.length > 0 && (
            <>
              <h2>{t.maxProducibleWhyHeader}</h2>
              <div className="card" style={{ padding: 0 }}>
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
                          style={isLimiter ? { background: 'rgba(220, 53, 69, 0.06)' } : undefined}
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
                            <strong>{b.maxUnits.toLocaleString(locale)}</strong> {t.unitsShort}
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
            </>
          )}
        </>
      )}
    </div>
  );
};

export default MaxProducibleView;
