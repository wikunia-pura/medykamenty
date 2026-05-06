import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { StockRow, ImportSummary, RawMaterial, PackagingComponent } from '../../shared/types';
import AIToggleButton from '../components/AIToggleButton';
import DropZone from '../components/DropZone';

interface Props {
  aiAvailable: boolean;
  useAiByDefault: boolean;
}

type StagedFile = { name: string; path: string; kind: 'raw' | 'component' };

function detectKind(name: string): 'raw' | 'component' {
  const lower = name.toLowerCase();
  if (lower.includes('komponen')) return 'component';
  // Default to raw materials when filename does not hint at components.
  return 'raw';
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
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [rawExpanded, setRawExpanded] = useState(false);
  const [compExpanded, setCompExpanded] = useState(false);
  const [rawSnapshotId, setRawSnapshotId] = useState<string | undefined>();
  const [compSnapshotId, setCompSnapshotId] = useState<string | undefined>();
  const [adoptBusy, setAdoptBusy] = useState(false);

  const loadCurrent = async () => {
    const [stock, rms, cs, snapshots] = await Promise.all([
      window.electronAPI.getCurrentStock(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
      window.electronAPI.listStockSnapshots(),
    ]);
    setRawRows(stock.raw);
    setCompRows(stock.components);
    setRawMaterials(rms);
    setComponents(cs);
    const latestRaw = snapshots.find((s) => s.kind === 'raw');
    const latestComp = snapshots.find((s) => s.kind === 'component');
    setRawSnapshotId(latestRaw?.id);
    setCompSnapshotId(latestComp?.id);
  };

  const adoptRow = async (row: StockRow, kind: 'raw' | 'component') => {
    const snapshotId = kind === 'raw' ? rawSnapshotId : compSnapshotId;
    if (!snapshotId) return;
    if (kind === 'raw') {
      const created = await window.electronAPI.createRawMaterial({
        name: row.name,
        mpFirmaSymbol: row.mpFirmaSymbol,
        unit: 'kg',
        supplierIds: [],
        factorySupplied: false,
        lastPurchasePriceNet: row.oNet,
        currency: row.currency,
      });
      await window.electronAPI.resolveStockMatch(snapshotId, row.rowKey, 'raw', created.id);
    } else {
      const created = await window.electronAPI.createComponent({
        name: row.name,
        type: 'other',
        mpFirmaSymbol: row.mpFirmaSymbol,
        supplierIds: [],
        lastPurchasePriceNet: row.oNet,
        currency: row.currency,
      });
      await window.electronAPI.resolveStockMatch(snapshotId, row.rowKey, 'component', created.id);
    }
  };

  const adoptOne = async (row: StockRow, kind: 'raw' | 'component') => {
    setError(null);
    setAdoptBusy(true);
    try {
      await adoptRow(row, kind);
      await loadCurrent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdoptBusy(false);
    }
  };

  const adoptAllUnmatched = async (kind: 'raw' | 'component') => {
    const rows = kind === 'raw' ? rawRows : compRows;
    const unmatched = rows.filter(
      (r) => !r.matchAmbiguous && !r.matchedRawMaterialId && !r.matchedComponentId,
    );
    if (unmatched.length === 0) return;
    if (!confirm(t.adoptAllConfirm.replace('{n}', String(unmatched.length)))) return;
    setError(null);
    setAdoptBusy(true);
    try {
      for (const row of unmatched) {
        await adoptRow(row, kind);
      }
      await loadCurrent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdoptBusy(false);
    }
  };

  useEffect(() => {
    void loadCurrent();
  }, []);

  const onFilesSelected = (files: { name: string; path: string }[]) => {
    setError(null);
    setSummary(null);
    setStaged((prev) => {
      const byPath = new Map(prev.map((f) => [f.path, f]));
      for (const f of files) {
        byPath.set(f.path, { ...f, kind: detectKind(f.name) });
      }
      return Array.from(byPath.values());
    });
  };

  const removeStaged = (path: string) =>
    setStaged((prev) => prev.filter((f) => f.path !== path));

  const setStagedKind = (path: string, kind: 'raw' | 'component') =>
    setStaged((prev) => prev.map((f) => (f.path === path ? { ...f, kind } : f)));

  const startImport = async () => {
    if (staged.length === 0) return;
    setError(null);
    setBusy(true);
    setSummary(null);
    try {
      // Pick one file per kind. If multiple are staged for the same kind,
      // import them sequentially via two import calls.
      const rawFiles = staged.filter((f) => f.kind === 'raw');
      const compFiles = staged.filter((f) => f.kind === 'component');

      const totals: ImportSummary = {
        snapshotIds: [],
        rawCount: 0,
        componentCount: 0,
        matched: 0,
        ambiguous: 0,
        unmatched: 0,
      };

      const accumulate = (s: ImportSummary) => {
        totals.snapshotIds = [...totals.snapshotIds, ...s.snapshotIds];
        totals.rawCount = (totals.rawCount ?? 0) + (s.rawCount ?? 0);
        totals.componentCount = (totals.componentCount ?? 0) + (s.componentCount ?? 0);
        totals.matched += s.matched;
        totals.ambiguous += s.ambiguous;
        totals.unmatched += s.unmatched;
      };

      const maxLen = Math.max(rawFiles.length, compFiles.length);
      for (let i = 0; i < maxLen; i++) {
        const args: { rawPath?: string; componentPath?: string } = {};
        if (rawFiles[i]) args.rawPath = rawFiles[i].path;
        if (compFiles[i]) args.componentPath = compFiles[i].path;
        const res = await window.electronAPI.importStock(args);
        accumulate(res);
      }

      setSummary(totals);
      setStaged([]);
      await loadCurrent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderRows = (rows: StockRow[], kind: 'raw' | 'component') => {
    const ambig = rows.filter((r) => r.matchAmbiguous).length;
    const matched = rows.filter((r) => !r.matchAmbiguous && (r.matchedRawMaterialId || r.matchedComponentId)).length;
    const unmatched = rows.length - matched - ambig;
    return (
      <>
        <div
          className="hint"
          style={{ marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
        >
          <div>
            {t.rowsImported}: {rows.length} ·{' '}
            <span className="tag success">{matched}</span> {t.rowsMatched.toLowerCase()} ·{' '}
            {ambig > 0 && <span className="tag warn">{ambig}</span>} {ambig > 0 ? `${t.rowsAmbiguous.toLowerCase()} ·` : ''}{' '}
            {unmatched > 0 && <span className="tag danger">{unmatched}</span>}{' '}
            {unmatched > 0 ? t.rowsUnmatched.toLowerCase() : ''}
          </div>
          {unmatched > 0 && (
            <button
              className="btn btn-sm"
              disabled={adoptBusy}
              onClick={() => void adoptAllUnmatched(kind)}
            >
              {adoptBusy ? t.loading : t.adoptAllUnmatched.replace('{n}', String(unmatched))}
            </button>
          )}
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
              const matchedRow = r.matchedRawMaterialId || r.matchedComponentId;
              return (
                <tr key={`${r.rowKey}-${idx}`}>
                  <td>{r.name}</td>
                  <td>{r.mpFirmaSymbol ?? ''}</td>
                  <td className="num">{r.qty}</td>
                  <td className="num">{r.oNet ?? ''}</td>
                  <td>
                    {r.matchAmbiguous ? (
                      <span className="tag warn">{t.rowsAmbiguous.toLowerCase()}</span>
                    ) : matchedRow ? (
                      <span className="tag success">✓</span>
                    ) : (
                      <>
                        <span className="tag danger">{t.rowsUnmatched.toLowerCase()}</span>{' '}
                        <button
                          className="btn btn-sm"
                          disabled={adoptBusy}
                          onClick={() => void adoptOne(r, kind)}
                          title={kind === 'raw' ? t.adoptAsRaw : t.adoptAsComponent}
                        >
                          + {kind === 'raw' ? t.rawMaterials : t.components}
                        </button>
                      </>
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
          </div>
        </div>

        <DropZone
          title={t.dropZoneTitle}
          subtitle={t.dropZoneSubtitle}
          dragOverLabel={t.dropZoneDragOver}
          accept=".xlsx"
          multiple
          disabled={busy}
          selectedFiles={staged}
          removeFileLabel={t.removeFile}
          onFilesSelected={onFilesSelected}
          onRemoveFile={removeStaged}
        />

        {staged.length > 0 && (
          <>
            <div style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>{t.name}</th>
                    <th>Typ</th>
                    <th className="actions">{t.actionsHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {staged.map((f) => (
                    <tr key={f.path}>
                      <td>{f.name}</td>
                      <td>
                        <select
                          value={f.kind}
                          onChange={(e) =>
                            setStagedKind(f.path, e.target.value as 'raw' | 'component')
                          }
                        >
                          <option value="raw">{t.rawMaterials}</option>
                          <option value="component">{t.components}</option>
                        </select>
                      </td>
                      <td className="actions">
                        <button className="btn btn-sm" onClick={() => removeStaged(f.path)}>
                          {t.delete}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                className="btn primary"
                disabled={busy}
                onClick={startImport}
              >
                {busy ? t.loading : t.importStockFiles}
              </button>
            </div>
          </>
        )}

        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
        {summary && (
          <div className="hint" style={{ marginTop: 8 }}>
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
          <h2
            style={{ marginTop: 0, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setRawExpanded((v) => !v)}
          >
            <span style={{ display: 'inline-block', width: 18 }}>{rawExpanded ? '▾' : '▸'}</span>
            {t.rawMaterials} ({rawRows.length})
          </h2>
          {rawExpanded && renderRows(rawRows, 'raw')}
        </div>
      )}

      {compRows.length > 0 && (
        <div className="card">
          <h2
            style={{ marginTop: 0, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setCompExpanded((v) => !v)}
          >
            <span style={{ display: 'inline-block', width: 18 }}>{compExpanded ? '▾' : '▸'}</span>
            {t.components} ({compRows.length})
          </h2>
          {compExpanded && renderRows(compRows, 'component')}
        </div>
      )}

      <div className="hint" style={{ marginTop: 8 }}>
        {t.rawMaterials}: {rawMaterials.length} · {t.components}: {components.length}
      </div>
    </div>
  );
};

export default StockImport;
