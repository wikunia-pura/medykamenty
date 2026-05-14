import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  Product,
  RawMaterial,
  PackagingComponent,
  RecipeImportAnalysis,
  RecipeImportMode,
  RecipeImportResolutions,
  RecipeImportSummary,
} from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import ColumnPicker from '../components/ColumnPicker';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconDuplicate,
  IconExport,
  IconImport,
} from '../components/Icons';
import HoverTooltip from '../components/HoverTooltip';
import ModalHeader from '../components/ModalHeader';
import ProductEditorModal from '../components/ProductEditorModal';
import RecipeUnresolvedModal from '../components/RecipeUnresolvedModal';
import { useEscapeKey } from '../utils/useEscapeKey';
import {
  exportProductsJson,
  importProductsJson,
  saveFile,
  openFile,
  formatStats,
} from '../utils/exportImport';

const Products: React.FC = () => {
  const t = useT();
  const [items, setItems] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [components, setComponents] = useState<PackagingComponent[]>([]);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [editingReadOnly, setEditingReadOnly] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  // Recipe XLSX import: when not null, the mode-selection modal is open with
  // this mode pre-selected. The actual file pick happens in the main process
  // after the user confirms the mode.
  const [recipeImportMode, setRecipeImportMode] = useState<RecipeImportMode | null>(null);
  const [recipeImportSummary, setRecipeImportSummary] = useState<RecipeImportSummary | null>(null);
  // The two-phase recipe import keeps the analysis output here between the
  // user picking the file (analyze) and resolving unmatched items (commit).
  const [recipeAnalysis, setRecipeAnalysis] = useState<RecipeImportAnalysis | null>(null);

  const closeEditor = () => {
    setEditing(null);
    setEditingReadOnly(false);
  };

  const openPreview = (p: Product) => {
    setEditing(p);
    setEditingReadOnly(true);
  };

  const COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.name, required: true },
      { id: 'sku', label: 'SKU', defaultVisible: true },
      { id: 'capacity', label: t.capacityMl, defaultVisible: true },
      { id: 'density', label: t.density, defaultVisible: true },
      { id: 'labor', label: t.laborCost, defaultVisible: false },
      { id: 'ingredients', label: t.ingredients, defaultVisible: true },
      { id: 'packaging', label: t.packaging, defaultVisible: true },
      { id: 'notes', label: t.notes, defaultVisible: false },
    ],
    [t],
  );
  const {
    isVisible,
    toggle,
    reorder,
    reset: resetColumns,
    orderedColumns,
    orderedVisibleIds,
  } = useColumnPrefs('products', COLUMNS);

  const headerFor = (id: string): React.ReactNode => {
    switch (id) {
      case 'name':
        return <th key={id} className="col-w-xl">{t.name}</th>;
      case 'sku':
        return <th key={id} className="col-w-md">SKU</th>;
      case 'capacity':
        return <th key={id} className="num col-w-sm">{t.capacityMl}</th>;
      case 'density':
        return <th key={id} className="num col-w-sm">{t.density}</th>;
      case 'labor':
        return <th key={id} className="num col-w-sm">{t.laborCost}</th>;
      case 'ingredients':
        return <th key={id} className="num col-w-sm">{t.ingredients}</th>;
      case 'packaging':
        return <th key={id} className="num col-w-sm">{t.packaging}</th>;
      case 'notes':
        return <th key={id} className="col-w-lg">{t.notes}</th>;
      default:
        return null;
    }
  };

  const rawName = (id: string) =>
    rawMaterials.find((r) => r.id === id)?.name ?? '?';
  const componentName = (id: string) =>
    components.find((c) => c.id === id)?.name ?? '?';

  const cellFor = (id: string, p: Product): React.ReactNode => {
    switch (id) {
      case 'name':
        return <td key={id} className="col-name col-wrap">{p.name}</td>;
      case 'sku':
        return <td key={id}>{p.sku ?? ''}</td>;
      case 'capacity':
        return <td key={id} className="num">{p.capacityMl}</td>;
      case 'density':
        return <td key={id} className="num">{p.densityGPerMl}</td>;
      case 'labor':
        return <td key={id} className="num">{p.conversionLaborCost ?? ''}</td>;
      case 'ingredients': {
        const ing = p.ingredients ?? [];
        if (ing.length === 0) {
          return <td key={id} className="num"><span className="hint">0</span></td>;
        }
        return (
          <td key={id} className="num">
            <HoverTooltip
              align="right"
              triggerClassName="count-bubble"
              trigger={ing.length}
            >
              <div className="shortage-tooltip-header">
                {t.ingredients} — {ing.length}
              </div>
              <ul className="shortage-tooltip-list">
                {ing.map((it, i) => (
                  <li key={`${it.rawMaterialId}-${i}`}>
                    <span className="shortage-tooltip-name">
                      {rawName(it.rawMaterialId)}
                    </span>
                    <span className="list-tooltip-amount">
                      {(it.percentage ?? 0).toLocaleString()} %
                    </span>
                  </li>
                ))}
              </ul>
            </HoverTooltip>
          </td>
        );
      }
      case 'packaging': {
        const pkg = p.packaging ?? [];
        if (pkg.length === 0) {
          return <td key={id} className="num"><span className="hint">0</span></td>;
        }
        return (
          <td key={id} className="num">
            <HoverTooltip
              align="right"
              triggerClassName="count-bubble"
              trigger={pkg.length}
            >
              <div className="shortage-tooltip-header">
                {t.packaging} — {pkg.length}
              </div>
              <ul className="shortage-tooltip-list">
                {pkg.map((pp, i) => (
                  <li key={`${pp.componentId}-${i}`}>
                    <span className="shortage-tooltip-name">
                      {componentName(pp.componentId)}
                    </span>
                    <span className="list-tooltip-amount">
                      {(pp.qtyPerUnit ?? 0).toLocaleString()} szt./op.
                    </span>
                  </li>
                ))}
              </ul>
            </HoverTooltip>
          </td>
        );
      }
      case 'notes':
        return <td key={id} className="col-wrap">{p.notes ?? ''}</td>;
      default:
        return null;
    }
  };

  const filtered = useMemo(
    () => items.filter((p) => matchesQuery(p, query)),
    [items, query],
  );

  const reload = async () => {
    const [list, rms, cs] = await Promise.all([
      window.electronAPI.listProducts(),
      window.electronAPI.listRawMaterials(),
      window.electronAPI.listComponents(),
    ]);
    setItems(list);
    setRawMaterials(rms);
    setComponents(cs);
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

  const onAdd = () => {
    setEditingReadOnly(false);
    setEditing({
      name: '',
      capacityMl: 100,
      densityGPerMl: 1.0,
      ingredients: [],
      packaging: [],
      archived: false,
    });
  };

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const sumPercent = (editing.ingredients ?? []).reduce(
      (acc, i) => acc + (i.percentage || 0),
      0,
    );
    if (sumPercent > 100.0001) {
      setError(t.recipeSumError);
      return;
    }
    const payload = {
      name: editing.name.trim(),
      sku: editing.sku?.trim() || undefined,
      capacityMl: editing.capacityMl ?? 0,
      densityGPerMl: editing.densityGPerMl ?? 1,
      conversionLaborCost: editing.conversionLaborCost,
      moqUnits: editing.moqUnits,
      sachetMassKg: editing.sachetMassKg,
      sachetsCount: editing.sachetsCount,
      ingredients: editing.ingredients ?? [],
      packaging: editing.packaging ?? [],
      notes: editing.notes?.trim() || undefined,
      archived: !!editing.archived,
    };
    try {
      if (editing.id) {
        await window.electronAPI.updateProduct(editing.id, payload);
      } else {
        await window.electronAPI.createProduct(payload);
      }
      closeEditor();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onExport = async () => {
    setError(null);
    setInfo(null);
    if (items.length === 0) {
      setInfo(t.exportEmpty);
      return;
    }
    setBusy(true);
    setLoaderMessage(t.loaderExporting);
    try {
      const { content, filename } = exportProductsJson(items, rawMaterials, components);
      await saveFile(filename, content, 'json');
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onImport = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
    try {
      const r = await openFile('json');
      if (!r.ok || !r.content) return;
      try {
        const stats = await importProductsJson(
          r.content,
          [...items],
          rawMaterials,
          components,
        );
        setInfo(formatStats(stats));
        await reload();
      } catch (err) {
        setError(`${t.importInvalidFile}: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onDelete = async (p: Product) => {
    setConfirmDelete(null);
    await window.electronAPI.deleteProduct(p.id);
    await reload();
  };

  const onDeleteAll = async () => {
    setConfirmDeleteAll(false);
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.deleteAllInProgress);
    const total = items.length;
    try {
      for (const p of items) {
        await window.electronAPI.deleteProduct(p.id);
      }
      setInfo(t.deleteAllSuccess.replace('{n}', String(total)));
      await reload();
    } catch (err) {
      setError((err as Error).message);
      await reload();
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onDuplicate = async (p: Product) => {
    const copy = await window.electronAPI.duplicateProduct(p.id);
    setEditingReadOnly(false);
    setEditing(copy);
    await reload();
  };

  // Phase 2 of the recipe import — given the user's per-item resolutions,
  // send them to the main process which now performs the actual product
  // upserts. Pulled out so the "no unresolved items" fast path can call it
  // directly with an empty resolutions payload.
  const commitRecipeImport = async (
    analysis: RecipeImportAnalysis,
    resolutions: RecipeImportResolutions,
  ) => {
    setBusy(true);
    setLoaderMessage(t.recipeUnresolvedCommitting);
    try {
      const res = await window.electronAPI.commitRecipesXlsx(
        analysis.filePath,
        analysis.mode,
        resolutions,
      );
      if (res.ok && res.summary) {
        setRecipeImportSummary(res.summary);
        await reload();
      } else if (res.error) {
        setError(`${t.recipesImportFailed}: ${res.error}`);
      }
    } catch (err) {
      setError(`${t.recipesImportFailed}: ${(err as Error).message}`);
    } finally {
      setRecipeAnalysis(null);
      setRecipeImportMode(null);
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  // Phase 1 of the recipe import — pick file + parse + match. If everything
  // already resolves (catalog covers all referenced names), skip the modal
  // and commit straight away. Otherwise leave the analysis on state so the
  // RecipeUnresolvedModal can render and call commitRecipeImport.
  const runRecipeImport = async (mode: RecipeImportMode) => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.recipeUnresolvedAnalyzing);
    try {
      const res = await window.electronAPI.analyzeRecipesXlsx(mode);
      // User cancelling the OS file picker returns ok:false with no error.
      if (!res.ok || !res.analysis) {
        setRecipeImportMode(null);
        if (res.error) setError(`${t.recipesImportFailed}: ${res.error}`);
        return;
      }
      const analysis = res.analysis;
      if (
        analysis.unresolvedRaws.length === 0 &&
        analysis.unresolvedComponents.length === 0
      ) {
        await commitRecipeImport(analysis, { rawMaterials: [], components: [] });
        return;
      }
      setRecipeAnalysis(analysis);
      setRecipeImportMode(null);
    } catch (err) {
      setError(`${t.recipesImportFailed}: ${(err as Error).message}`);
      setRecipeImportMode(null);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onConfirmRecipeImport = async () => {
    if (!recipeImportMode) return;
    await runRecipeImport(recipeImportMode);
  };

  // When the list is empty, merge and overwrite are equivalent — skip the
  // dialog and import straight away.
  const onClickRecipeImport = () => {
    if (items.length === 0) {
      void runRecipeImport('merge');
    } else {
      setRecipeImportMode('merge');
    }
  };

  const onExportRecipes = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.loaderExporting);
    try {
      const res = await window.electronAPI.exportRecipesXlsx();
      if (res.ok && res.path) {
        setInfo(`${t.recipesExportSuccess}: ${res.path}`);
      } else if (res.error) {
        setError(`${t.recipesExportFailed}: ${res.error}`);
      }
    } catch (err) {
      setError(`${t.recipesExportFailed}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{t.products}</h1>
        <span className="page-header-count">{items.length}</span>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-actions">
            <button
              className="btn btn-export"
              onClick={onExport}
              disabled={busy}
              title={t.exportLabel}
            >
              <IconExport size={13} /> {t.exportLabel}
            </button>
            <button
              className="btn btn-export"
              onClick={onExportRecipes}
              disabled={busy || items.length === 0}
              title={t.recipesExportXlsx}
            >
              <IconExport size={13} /> {t.recipesExportXlsx}
            </button>
            <button
              className="btn btn-import"
              onClick={onImport}
              disabled={busy}
              title={t.importLabel}
            >
              <IconImport size={13} /> {t.importLabel}
            </button>
            <button
              className="btn btn-import"
              onClick={onClickRecipeImport}
              disabled={busy}
              title={t.recipesImportXlsx}
            >
              <IconImport size={13} /> {t.recipesImportXlsx}
            </button>
            <ColumnPicker
              columns={orderedColumns}
              isVisible={isVisible}
              toggle={toggle}
              reorder={reorder}
              reset={resetColumns}
            />
            <button
              className="btn danger"
              onClick={() => setConfirmDeleteAll(true)}
              disabled={busy || items.length === 0}
              title={t.deleteAll}
            >
              <IconTrash size={13} /> {t.deleteAll}
            </button>
            <button className="btn primary toolbar-action-primary" onClick={onAdd}>
              <IconPlus size={14} /> {t.add}
            </button>
          </div>
          <div className="toolbar-search">
            <SearchInput value={query} onChange={setQuery} block />
          </div>
        </div>
        {error && <div className="error-text" style={{ marginBottom: 8 }}>{error}</div>}
        {info && <div className="hint" style={{ marginBottom: 8 }}>{info}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {orderedVisibleIds.map((id) => headerFor(id))}
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={orderedVisibleIds.length + 1} className="hint">
                    {query ? '—' : t.noData}
                  </td>
                </tr>
              )}
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  className="row-clickable"
                  onClick={() => openPreview(p)}
                  title={t.preview}
                >
                  {orderedVisibleIds.map((id) => cellFor(id, p))}
                  <td
                    className="actions actions-sticky"
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <div className="btn-row">
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={() => {
                          setEditingReadOnly(false);
                          setEditing(p);
                        }}
                        title={t.edit}
                      >
                        <IconEdit size={13} /> {t.edit}
                      </button>
                      <button
                        className="btn btn-sm soft-success"
                        onClick={() => onDuplicate(p)}
                        title={t.duplicate}
                      >
                        <IconDuplicate size={13} /> {t.duplicate}
                      </button>
                      <button
                        className="btn btn-sm soft-danger"
                        onClick={() => setConfirmDelete(p)}
                        title={t.delete}
                      >
                        <IconTrash size={13} /> {t.delete}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <ProductEditorModal
          editing={editing}
          rawMaterials={rawMaterials}
          components={components}
          setEditing={setEditing}
          onCancel={closeEditor}
          onSave={onSave}
          error={error}
          readOnly={editingReadOnly}
          onEnterEdit={() => setEditingReadOnly(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`${t.delete}: ${confirmDelete.name}?`}
          onConfirm={() => onDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}

      {confirmDeleteAll && (
        <ConfirmDialog
          message={t.deleteAllConfirm.replace('{n}', String(items.length))}
          onConfirm={onDeleteAll}
          onCancel={() => setConfirmDeleteAll(false)}
          danger
        />
      )}

      {recipeImportMode !== null && (
        <RecipeImportModeDialog
          mode={recipeImportMode}
          onChange={setRecipeImportMode}
          onCancel={() => setRecipeImportMode(null)}
          onConfirm={onConfirmRecipeImport}
          busy={busy}
        />
      )}

      {recipeAnalysis && (
        <RecipeUnresolvedModal
          rawItems={recipeAnalysis.unresolvedRaws}
          componentItems={recipeAnalysis.unresolvedComponents}
          busy={busy}
          onApply={(resolutions) => void commitRecipeImport(recipeAnalysis, resolutions)}
          onCancel={() => setRecipeAnalysis(null)}
        />
      )}

      {recipeImportSummary && (
        <RecipeImportSummaryModal
          summary={recipeImportSummary}
          onClose={() => setRecipeImportSummary(null)}
        />
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

// ---------- Recipe import mode picker ----------

interface ModeDialogProps {
  mode: RecipeImportMode;
  onChange: (m: RecipeImportMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}

const RecipeImportModeDialog: React.FC<ModeDialogProps> = ({
  mode,
  onChange,
  onCancel,
  onConfirm,
  busy,
}) => {
  const t = useT();
  useEscapeKey(onCancel, !busy);
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconImport size={18} />}
          tone="add"
          title={t.recipesImportDialogTitle}
          onClose={onCancel}
        />
        <div className="modal-body">
          <label
            className="form-row"
            style={{ alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="recipe-import-mode"
              checked={mode === 'merge'}
              onChange={() => onChange('merge')}
              disabled={busy}
              style={{ marginTop: 4 }}
            />
            <div style={{ marginLeft: 8 }}>
              <strong>{t.recipesImportModeMerge}</strong>
              <div className="hint" style={{ marginTop: 4 }}>
                {t.recipesImportModeMergeDesc}
              </div>
            </div>
          </label>
          <label
            className="form-row"
            style={{ alignItems: 'flex-start', cursor: 'pointer' }}
          >
            <input
              type="radio"
              name="recipe-import-mode"
              checked={mode === 'overwrite'}
              onChange={() => onChange('overwrite')}
              disabled={busy}
              style={{ marginTop: 4 }}
            />
            <div style={{ marginLeft: 8 }}>
              <strong>{t.recipesImportModeOverwrite}</strong>
              <div className="hint" style={{ marginTop: 4 }}>
                {t.recipesImportModeOverwriteDesc}
              </div>
            </div>
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel} disabled={busy}>
            {t.cancel}
          </button>
          <button
            className={`btn ${mode === 'overwrite' ? 'danger' : 'primary-filled'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {t.recipesImportConfirm}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------- Recipe import summary ----------

interface SummaryModalProps {
  summary: RecipeImportSummary;
  onClose: () => void;
}

const RecipeImportSummaryModal: React.FC<SummaryModalProps> = ({ summary, onClose }) => {
  const t = useT();
  useEscapeKey(onClose);
  const productsWithWarnings = summary.perProduct.filter(
    (p) => p.warnings.length > 0 || p.qtyReviewNeeded.length > 0,
  );
  const showQtyNote = summary.perProduct.some((p) => p.qtyReviewNeeded.length > 0);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconImport size={18} />}
          tone="edit"
          title={`${t.recipesImportSummaryTitle} — ${summary.fileName}`}
          onClose={onClose}
        />
        <div className="modal-body">
          <div className="form-row" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <Stat label={t.recipesImportProductsCreated} value={summary.productsCreated} />
            <Stat label={t.recipesImportProductsUpdated} value={summary.productsUpdated} />
            {summary.productsSkipped > 0 && (
              <Stat label={t.recipesImportProductsSkipped} value={summary.productsSkipped} />
            )}
            <Stat label={t.recipesImportRawCreated} value={summary.rawMaterialsCreated} />
            <Stat label={t.recipesImportComponentsCreated} value={summary.componentsCreated} />
          </div>

          {showQtyNote && (
            <div className="error-text" style={{ marginTop: 12, marginBottom: 12 }}>
              {t.recipesImportQtyReviewNote}
            </div>
          )}

          {summary.globalWarnings.length > 0 && (
            <>
              <h4 style={{ marginTop: 16, marginBottom: 8 }}>{t.recipesImportWarnings}</h4>
              <ul style={{ paddingLeft: 18 }}>
                {summary.globalWarnings.map((w, i) => (
                  <li key={i} className="hint">{w}</li>
                ))}
              </ul>
            </>
          )}

          {productsWithWarnings.length > 0 && (
            <>
              <h4 style={{ marginTop: 16, marginBottom: 8 }}>{t.recipesImportPerProductTitle}</h4>
              <div className="table-wrap" style={{ maxHeight: 400, overflow: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.name}</th>
                      <th className="num">{t.ingredients}</th>
                      <th className="num">{t.packaging}</th>
                      <th>{t.recipesImportWarnings}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productsWithWarnings.map((p, i) => (
                      <tr key={`${p.productName}-${i}`}>
                        <td>{p.productName}</td>
                        <td className="num">{p.ingredientCount}</td>
                        <td className="num">{p.packagingCount}</td>
                        <td>
                          {p.qtyReviewNeeded.length > 0 && (
                            <div className="hint" style={{ marginBottom: 4 }}>
                              qty=1: {p.qtyReviewNeeded.join(', ')}
                            </div>
                          )}
                          {p.warnings.map((w, j) => (
                            <div key={j} className="hint">{w}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn primary-filled" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div>
    <div className="hint" style={{ fontSize: 12 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
  </div>
);

export default Products;
