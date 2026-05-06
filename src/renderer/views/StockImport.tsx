import React, { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { StockRow, ImportSummary, RawMaterial, PackagingComponent } from '../../shared/types';
import type { ViewKey } from './types';
import AIToggleButton from '../components/AIToggleButton';
import DropZone from '../components/DropZone';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import ConfirmDialog from '../components/ConfirmDialog';
import { IconTrash, IconPlus, IconCheck, IconEdit, IconClose } from '../components/Icons';

interface Props {
  aiAvailable: boolean;
  useAiByDefault: boolean;
  onNavigate?: (key: ViewKey) => void;
}

type StagedFile = { name: string; path: string; kind: 'raw' | 'component' };
type SnapshotInfo = { id: string; importedAt: string; sourceFile: string } | null;

function detectKind(name: string): 'raw' | 'component' {
  const lower = name.toLowerCase();
  if (lower.includes('komponen')) return 'component';
  return 'raw';
}

const StockImport: React.FC<Props> = ({ aiAvailable, useAiByDefault, onNavigate }) => {
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
  const [rawSnapshot, setRawSnapshot] = useState<SnapshotInfo>(null);
  const [compSnapshot, setCompSnapshot] = useState<SnapshotInfo>(null);
  const [adoptBusy, setAdoptBusy] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [compQuery, setCompQuery] = useState('');
  const [rawUnmatchedOnly, setRawUnmatchedOnly] = useState(false);
  const [compUnmatchedOnly, setCompUnmatchedOnly] = useState(false);
  const [editingRow, setEditingRow] = useState<{
    row: StockRow;
    kind: 'raw' | 'component';
    snapshotId: string;
  } | null>(null);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<{
    row: StockRow;
    snapshotId: string;
  } | null>(null);
  const [confirmDeleteSnapshot, setConfirmDeleteSnapshot] = useState<
    'raw' | 'component' | null
  >(null);

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
    setRawSnapshot(stock.rawSnapshot);
    setCompSnapshot(stock.componentSnapshot);
  };

  const adoptRow = async (row: StockRow, kind: 'raw' | 'component') => {
    const snapshotId = kind === 'raw' ? rawSnapshot?.id : compSnapshot?.id;
    if (!snapshotId) return;
    if (kind === 'raw') {
      const created = await window.electronAPI.createRawMaterial({
        name: row.name,
        mpFirmaSymbol: row.mpFirmaSymbol,
        unit: 'kg',
        supplierIds: [],
        factorySupplied: false,
        lastPurchasePriceNet: row.netPrice,
        currency: row.currency,
      });
      await window.electronAPI.resolveStockMatch(snapshotId, row.rowKey, 'raw', created.id);
    } else {
      const created = await window.electronAPI.createComponent({
        name: row.name,
        type: 'other',
        mpFirmaSymbol: row.mpFirmaSymbol,
        supplierIds: [],
        lastPurchasePriceNet: row.netPrice,
        currency: row.currency,
      });
      await window.electronAPI.resolveStockMatch(
        snapshotId,
        row.rowKey,
        'component',
        created.id,
      );
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

  const onDeleteRow = async () => {
    if (!confirmDeleteRow) return;
    const { row, snapshotId } = confirmDeleteRow;
    setConfirmDeleteRow(null);
    await window.electronAPI.deleteStockRow(snapshotId, row.rowKey);
    await loadCurrent();
  };

  const onDeleteSnapshot = async () => {
    if (!confirmDeleteSnapshot) return;
    const kind = confirmDeleteSnapshot;
    setConfirmDeleteSnapshot(null);
    // Delete every snapshot of this kind (not just the latest) — there can be
    // older retained snapshots that would otherwise resurface as "current".
    await window.electronAPI.deleteStockSnapshotsByKind(kind);
    if (kind === 'raw') {
      setRawRows([]);
      setRawSnapshot(null);
    } else {
      setCompRows([]);
      setCompSnapshot(null);
    }
    await loadCurrent();
  };

  const onSaveEditing = async () => {
    if (!editingRow) return;
    const { row, snapshotId } = editingRow;
    await window.electronAPI.updateStockRow(snapshotId, row.rowKey, row);
    setEditingRow(null);
    await loadCurrent();
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
      if (rawFiles.length > 0) setRawExpanded(false);
      if (compFiles.length > 0) setCompExpanded(false);
      await loadCurrent();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isUnmatched = (r: StockRow) =>
    !r.matchAmbiguous && !r.matchedRawMaterialId && !r.matchedComponentId;

  const renderRows = (rows: StockRow[], kind: 'raw' | 'component') => {
    const snapshotId = kind === 'raw' ? rawSnapshot?.id : compSnapshot?.id;
    if (!snapshotId) return null;
    const unmatched = rows.filter(isUnmatched).length;
    const query = kind === 'raw' ? rawQuery : compQuery;
    const setQuery = kind === 'raw' ? setRawQuery : setCompQuery;
    const unmatchedOnly = kind === 'raw' ? rawUnmatchedOnly : compUnmatchedOnly;
    const setUnmatchedOnly = kind === 'raw' ? setRawUnmatchedOnly : setCompUnmatchedOnly;

    let filtered = rows;
    if (unmatchedOnly) filtered = filtered.filter(isUnmatched);
    if (query.trim()) filtered = filtered.filter((r) => matchesQuery(r, query));

    return (
      <>
        {unmatched === 0 && (
          <div style={{ marginBottom: 12 }}>
            <span className="tag success">
              <IconCheck size={11} /> {t.stockAllMatched}
            </span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 280 }}>
            <SearchInput
              value={query}
              onChange={setQuery}
              block
              rightAdornment={
                unmatched > 0 ? (
                  <button
                    type="button"
                    className={`filter-chip ${unmatchedOnly ? 'active' : ''}`}
                    onClick={() => setUnmatchedOnly(!unmatchedOnly)}
                    title={t.stockUnmatchedOnly}
                  >
                    {t.stockUnmatchedOnly}
                    <span className="filter-chip-count">{unmatched}</span>
                  </button>
                ) : null
              }
            />
          </div>
          {unmatched > 0 && (
            <button
              className="btn btn-sm soft-success"
              disabled={adoptBusy}
              onClick={() => void adoptAllUnmatched(kind)}
            >
              <IconPlus size={13} />{' '}
              {adoptBusy ? t.loading : t.adoptAllUnmatched.replace('{n}', String(unmatched))}
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="col-name-wide">{t.name}</th>
                <th className="col-w-match">Match</th>
                <th className="num col-w-sm">{t.quantity}</th>
                <th className="num col-w-sm">{t.stockNetUnit}</th>
                <th className="num col-w-sm">{t.stockVatUnit}</th>
                <th className="num col-w-sm">{t.stockGrossUnit}</th>
                <th className="col-w-sm">{t.currency}</th>
                <th className="num col-w-sm">{t.stockNetTotal}</th>
                <th className="num col-w-sm">{t.stockVatTotal}</th>
                <th className="num col-w-sm">{t.stockGrossTotal}</th>
                <th className="col-w-md">{t.symbol}</th>
                <th className="col-w-md">{t.stockManufacturer}</th>
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={13} className="hint">
                    {query || unmatchedOnly ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filtered.slice(0, 200).map((r, idx) => {
                const matchedRow = r.matchedRawMaterialId || r.matchedComponentId;
                return (
                  <tr key={`${r.rowKey}-${idx}`}>
                    <td className="col-name col-wrap">{r.name}</td>
                    <td className="col-match">
                      {r.matchAmbiguous ? (
                        <span
                          className="match-badge warn"
                          title={t.rowsAmbiguous}
                          aria-label={t.rowsAmbiguous}
                        >
                          ?
                        </span>
                      ) : matchedRow ? (
                        <span
                          className="match-badge success"
                          title={t.rowsMatched}
                          aria-label={t.rowsMatched}
                        >
                          <IconCheck size={12} />
                        </span>
                      ) : (
                        <button
                          className="match-badge danger as-button"
                          disabled={adoptBusy}
                          onClick={() => void adoptOne(r, kind)}
                          title={
                            kind === 'raw' ? t.adoptAsRaw : t.adoptAsComponent
                          }
                          aria-label={
                            kind === 'raw' ? t.adoptAsRaw : t.adoptAsComponent
                          }
                        >
                          <IconPlus size={12} />
                        </button>
                      )}
                    </td>
                    <td className="num">{r.qty}</td>
                    <td className="num">{r.netPrice ?? ''}</td>
                    <td className="num">{r.vatPrice ?? ''}</td>
                    <td className="num">{r.grossPrice ?? ''}</td>
                    <td>{r.currency ?? ''}</td>
                    <td className="num">{r.oNet ?? ''}</td>
                    <td className="num">{r.oVat ?? ''}</td>
                    <td className="num">{r.oGross ?? ''}</td>
                    <td>{r.mpFirmaSymbol ?? ''}</td>
                    <td>{r.manufacturerSymbol ?? ''}</td>
                    <td className="actions actions-sticky">
                      <div className="btn-row">
                        <button
                          className="btn btn-sm soft-edit"
                          onClick={() => setEditingRow({ row: r, kind, snapshotId })}
                          title={t.stockEditRow}
                        >
                          <IconEdit size={13} /> {t.edit}
                        </button>
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={() => setConfirmDeleteRow({ row: r, snapshotId })}
                          title={t.stockDeleteRow}
                        >
                          <IconTrash size={13} /> {t.delete}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length > 200 && (
                <tr>
                  <td colSpan={13} className="hint">
                    … +{filtered.length - 200}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </>
    );
  };

  const renderSnapshotCard = (
    kind: 'raw' | 'component',
    rows: StockRow[],
    snapshot: SnapshotInfo,
  ) => {
    if (!snapshot || rows.length === 0) return null;
    const expanded = kind === 'raw' ? rawExpanded : compExpanded;
    const setExpanded = kind === 'raw' ? setRawExpanded : setCompExpanded;
    const title = kind === 'raw' ? t.rawMaterials : t.components;
    const importedAt = new Date(snapshot.importedAt).toLocaleString();
    const unmatched = rows.filter(isUnmatched).length;
    return (
      <div className="card">
        <div className="card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h2
              style={{ margin: 0, cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setExpanded((v) => !v)}
            >
              <span style={{ display: 'inline-block', width: 18 }}>
                {expanded ? '▾' : '▸'}
              </span>
              {title} ({rows.length})
            </h2>
            {unmatched > 0 && (
              <span className="tag danger">
                {t.rowsUnmatched}: {unmatched}
              </span>
            )}
            <span className="hint">
              {t.stockSourceFile}: <code>{snapshot.sourceFile}</code> · {t.stockSnapshotImported}:{' '}
              {importedAt}
            </span>
          </div>
          <button
            className="btn btn-sm danger"
            onClick={() => setConfirmDeleteSnapshot(kind)}
            title={t.stockDeleteSnapshot}
          >
            <IconTrash size={13} /> {t.stockDeleteSnapshot}
          </button>
        </div>
        {expanded && renderRows(rows, kind)}
      </div>
    );
  };

  return (
    <div className="main">
      <div className="page-header">
        <h1>{t.stockImport}</h1>
        {(rawRows.length > 0 || compRows.length > 0) && (
          <span className="page-header-count">
            ({rawRows.length + compRows.length})
          </span>
        )}
      </div>
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
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th className="col-w-xl">{t.name}</th>
                    <th className="col-w-md">Typ</th>
                    <th className="actions">{t.actionsHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {staged.map((f) => (
                    <tr key={f.path}>
                      <td className="col-name col-wrap">{f.name}</td>
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
                        <button
                          className="btn btn-sm soft-danger"
                          onClick={() => removeStaged(f.path)}
                          title={t.delete}
                        >
                          <IconTrash size={13} /> {t.delete}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="btn primary" disabled={busy} onClick={startImport}>
                <IconPlus size={14} /> {busy ? t.loading : t.importStockFiles}
              </button>
            </div>
          </>
        )}

        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
        {summary && (
          <div className="hint" style={{ marginTop: 8 }}>
            {t.rowsImported}: {(summary.rawCount ?? 0) + (summary.componentCount ?? 0)} ·{' '}
            {t.rowsUnmatched}: {summary.unmatched}
          </div>
        )}
      </div>

      {rawRows.length === 0 && compRows.length === 0 && (
        <div className="card">{t.noStockYet}</div>
      )}

      {renderSnapshotCard('raw', rawRows, rawSnapshot)}
      {renderSnapshotCard('component', compRows, compSnapshot)}

      <div className="hint" style={{ marginTop: 8 }}>
        {t.rawMaterials}: {rawMaterials.length} · {t.components}: {components.length}
      </div>

      {editingRow && (
        <EditRowDialog
          row={editingRow.row}
          onChange={(next) => setEditingRow({ ...editingRow, row: next })}
          onSave={onSaveEditing}
          onCancel={() => setEditingRow(null)}
        />
      )}

      {confirmDeleteRow && (
        <ConfirmDialog
          message={`${t.stockDeleteRow}: ${confirmDeleteRow.row.name}?`}
          onConfirm={onDeleteRow}
          onCancel={() => setConfirmDeleteRow(null)}
          danger
        />
      )}

      {confirmDeleteSnapshot && (
        <ConfirmDialog
          message={t.stockDeleteSnapshotConfirm.replace(
            '{kind}',
            confirmDeleteSnapshot === 'raw' ? t.rawMaterials : t.components,
          )}
          onConfirm={onDeleteSnapshot}
          onCancel={() => setConfirmDeleteSnapshot(null)}
          danger
        />
      )}

      {onNavigate && (
        <button
          className="floating-next"
          onClick={() => onNavigate('shortageReport')}
          title={t.goToShortageReport}
        >
          <span className="floating-next-step">2</span>
          <span className="floating-next-text">
            <span className="floating-next-hint">{t.nextStep}</span>
            <span>{t.shortageReport}</span>
          </span>
          <span className="floating-next-arrow">→</span>
        </button>
      )}
    </div>
  );
};

interface EditRowProps {
  row: StockRow;
  onChange: (r: StockRow) => void;
  onSave: () => void;
  onCancel: () => void;
}

const EditRowDialog: React.FC<EditRowProps> = ({ row, onChange, onSave, onCancel }) => {
  const t = useT();
  const num = (v: string): number | undefined =>
    v === '' ? undefined : Number(v);
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-text">
            <h2 className="modal-title">{t.stockEditRow}</h2>
            <p className="modal-subtitle">{row.name}</p>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onCancel}
            title={t.close}
            aria-label={t.close}
          >
            <IconClose size={16} />
          </button>
        </div>
        <div className="modal-body">
        <div className="form-row">
          <label>{t.name}</label>
          <input
            className="input"
            value={row.name}
            onChange={(e) => onChange({ ...row, name: e.target.value })}
          />
        </div>
        <div className="form-row">
          <label>{t.symbol}</label>
          <input
            className="input"
            value={row.mpFirmaSymbol ?? ''}
            onChange={(e) => onChange({ ...row, mpFirmaSymbol: e.target.value || undefined })}
          />
        </div>
        <div className="form-row">
          <label>{t.stockManufacturer}</label>
          <input
            className="input"
            value={row.manufacturerSymbol ?? ''}
            onChange={(e) =>
              onChange({ ...row, manufacturerSymbol: e.target.value || undefined })
            }
          />
        </div>
        <div className="form-row">
          <label>{t.stockWarehouse}</label>
          <input
            className="input"
            value={row.warehouse ?? ''}
            onChange={(e) => onChange({ ...row, warehouse: e.target.value || undefined })}
          />
        </div>
        <div className="form-row">
          <label>{t.quantity}</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={row.qty}
            onChange={(e) => onChange({ ...row, qty: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="form-row">
          <label>{t.stockNetUnit}</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={row.netPrice ?? ''}
            onChange={(e) => onChange({ ...row, netPrice: num(e.target.value) })}
          />
        </div>
        <div className="form-row">
          <label>{t.stockVatUnit}</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={row.vatPrice ?? ''}
            onChange={(e) => onChange({ ...row, vatPrice: num(e.target.value) })}
          />
        </div>
        <div className="form-row">
          <label>{t.stockGrossUnit}</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={row.grossPrice ?? ''}
            onChange={(e) => onChange({ ...row, grossPrice: num(e.target.value) })}
          />
        </div>
        <div className="form-row">
          <label>{t.currency}</label>
          <input
            className="input"
            value={row.currency ?? ''}
            onChange={(e) => onChange({ ...row, currency: e.target.value || undefined })}
          />
        </div>
        <div className="form-row">
          <label>{t.stockNetTotal}</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={row.oNet ?? ''}
            onChange={(e) => onChange({ ...row, oNet: num(e.target.value) })}
          />
        </div>
        <div className="form-row">
          <label>{t.stockVatTotal}</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={row.oVat ?? ''}
            onChange={(e) => onChange({ ...row, oVat: num(e.target.value) })}
          />
        </div>
        <div className="form-row">
          <label>{t.stockGrossTotal}</label>
          <input
            className="input"
            type="number"
            step="0.01"
            value={row.oGross ?? ''}
            onChange={(e) => onChange({ ...row, oGross: num(e.target.value) })}
          />
        </div>
        <div className="form-row">
          <label>{t.notes}</label>
          <textarea
            value={row.notes ?? ''}
            onChange={(e) => onChange({ ...row, notes: e.target.value || undefined })}
          />
        </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className="btn primary-filled" onClick={onSave}>
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockImport;
