import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { Product, MaxProducibleResult } from '../../shared/types';

const MaxProducibleView: React.FC = () => {
  const t = useT();
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
            {busy ? t.loading : t.computeShortages}
          </button>
        </div>
      </div>

      {result && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>
            {result.productName}: <strong>{result.units}</strong>{' '}
            <span className="hint">{t.products.toLowerCase()}</span>
          </h2>
          <table className="table">
            <thead>
              <tr>
                <th>{t.name}</th>
                <th>Typ</th>
                <th className="num">{t.available}</th>
                <th className="num">/szt.</th>
                <th className="num">Max</th>
              </tr>
            </thead>
            <tbody>
              {result.bottlenecks.map((b) => (
                <tr key={`${b.kind}-${b.itemId}`}>
                  <td>{b.itemName}</td>
                  <td>
                    <span className="tag">{b.kind}</span>
                  </td>
                  <td className="num">{b.available.toFixed(2)}</td>
                  <td className="num">{b.needPerUnit.toFixed(4)}</td>
                  <td className="num">
                    <strong>{b.maxUnits}</strong>
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

export default MaxProducibleView;
