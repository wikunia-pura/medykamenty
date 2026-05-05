import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { StockRow, ImportSummary, RawMaterial, PackagingComponent } from '../../shared/types';
import AIToggleButton from '../components/AIToggleButton';

interface Props {
  aiAvailable: boolean;
  useAiByDefault: boolean;
}

const StockImport: React.FC<Props> = ({ aiAvailable, useAiByDefault }) => {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [rawRows, setRawRows] = useState<StockRow[]>([]);
  const [compRows, setCompRows] = useState<StockRow[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [useAi, setUseAi] = useState(useAiByDefault);
  const [error, setError] = useState<string | null>(null);

  const loadCurrent = async () => {
    const [stock, rms, cs] = await Promise.all([
      window.electronAPI.getCurrentStock(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
    ]);
    setRawRows(stock.raw);
    setCompRows(stock.components);
    setRawMaterials(rms);
    setComponents(cs);
  };

  useEffect(() => {
    void loadCurrent();
  }, []);

  const startImport = async () => {
    setError(null);
    setBusy(true);
    setSummary(null);
    try {
      const files = await window.electronAPI.selectStockFiles();
      if (!files.rawPath && !files.componentPath) {
        setBusy(false);
        return;
      }
      const result = await window.electronAPI.importStock(files);
      setSummary(result);
      await loadCurrent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderRows = (rows: StockRow[], _kind: 'raw' | 'component') => {
    const ambig = rows.filter((r) => r.matchAmbiguous).length;
    const matched = rows.filter((r) => !r.matchAmbiguous && (r.matchedRawMaterialId || r.matchedComponentId)).length;
    const unmatched = rows.length - matched - ambig;
    return (
      <>
        <div className="hint" style={{ marginBottom: 8 }}>
          {t.rowsImported}: {rows.length} ·{' '}
          <span className="tag success">{matched}</span> {t.rowsMatched.toLowerCase()} ·{' '}
          {ambig > 0 && <span className="tag warn">{ambig}</span>} {ambig > 0 ? `${t.rowsAmbiguous.toLowerCase()} ·` : ''}{' '}
          {unmatched > 0 && <span className="tag danger">{unmatched}</span>}{' '}
          {unmatched > 0 ? t.rowsUnmatched.toLowerCase() : ''}
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>{t.name}</th>
              <th>{t.symbol}</th>
              <th className="num">{t.quantity}</th>
              <th className="num">ONetto Z</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((r, idx) => {
              const matched = r.matchedRawMaterialId || r.matchedComponentId;
              return (
                <tr key={`${r.rowKey}-${idx}`}>
                  <td>{r.name}</td>
                  <td>{r.mpFirmaSymbol ?? ''}</td>
                  <td className="num">{r.qty}</td>
                  <td className="num">{r.oNet ?? ''}</td>
                  <td>
                    {r.matchAmbiguous ? (
                      <span className="tag warn">{t.rowsAmbiguous.toLowerCase()}</span>
                    ) : matched ? (
                      <span className="tag success">✓</span>
                    ) : (
                      <span className="tag danger">{t.rowsUnmatched.toLowerCase()}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length > 200 && (
              <tr>
                <td colSpan={5} className="hint">
                  … +{rows.length - 200}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </>
    );
  };

  return (
    <div className="main">
      <h1>{t.stockImport}</h1>
      <p className="subtitle">
        Import xlsx z MP Firma. Aplikacja dopasuje pozycje do istniejących surowców i komponentów po
        symbolu lub nazwie. Pozycje wieloznaczne lub nierozpoznane można rozstrzygnąć ręcznie.
      </p>

      <div className="card">
        <div className="card-header">
          <div className="card-title">{t.selectXlsxFiles}</div>
          <div className="row">
            <AIToggleButton enabled={useAi} onChange={setUseAi} available={aiAvailable} />
            <button className="btn primary" disabled={busy} onClick={startImport}>
              {busy ? t.loading : t.importStockFiles}
            </button>
          </div>
        </div>
        {error && <div className="error-text">{error}</div>}
        {summary && (
          <div className="hint">
            {t.rowsImported}: {(summary.rawCount ?? 0) + (summary.componentCount ?? 0)} ·{' '}
            {t.rowsMatched}: {summary.matched} ·{' '}
            {t.rowsAmbiguous}: {summary.ambiguous} ·{' '}
            {t.rowsUnmatched}: {summary.unmatched}
          </div>
        )}
      </div>

      {rawRows.length === 0 && compRows.length === 0 && (
        <div className="card">{t.noStockYet}</div>
      )}

      {rawRows.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t.rawMaterials} ({rawRows.length})</h2>
          {renderRows(rawRows, 'raw')}
        </div>
      )}

      {compRows.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t.components} ({compRows.length})</h2>
          {renderRows(compRows, 'component')}
        </div>
      )}

      <div className="hint" style={{ marginTop: 8 }}>
        {t.rawMaterials}: {rawMaterials.length} · {t.components}: {components.length}
      </div>
    </div>
  );
};

export default StockImport;
