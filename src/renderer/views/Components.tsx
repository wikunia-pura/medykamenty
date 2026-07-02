import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  AppSettings,
  ComponentDependency,
  PackagingComponent,
  PackingCapacityUnit,
  Supplier,
  ComponentType,
  ComponentsImportSummary,
  RawMaterialsImportMode,
  MagazynStockAnalysis,
  MagazynStockDecision,
} from '../../shared/types';
import { isSecondaryComponent, SECONDARY_COMPONENT_TYPES } from '../../shared/types';
import ConfirmDialog from '../components/ConfirmDialog';
import BlockedByDialog from '../components/BlockedByDialog';
import LoadingOverlay from '../components/LoadingOverlay';
import SupplierMultiPicker from '../components/SupplierMultiPicker';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';
import StockCell from '../components/StockCell';
import OverageCell from '../components/OverageCell';
import ColumnPicker from '../components/ColumnPicker';
import HoverTooltip from '../components/HoverTooltip';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import { IconEdit, IconTrash, IconPlus, IconStar, IconClose, IconEye, IconDuplicate, IconImport, IconInfo, IconSettings } from '../components/Icons';
import ModalHeader from '../components/ModalHeader';
import ExportImportButtons from '../components/ExportImportButtons';
import { useEscapeKey } from '../utils/useEscapeKey';
import {
  exportComponentsCsv,
  importComponentsCsv,
  saveFile,
  openFile,
  formatStats,
} from '../utils/exportImport';

const PRIMARY_TYPES: ComponentType[] = [
  'tube',
  'bottle',
  'jar',
  'label',
  'cap',
  'pump',
  'pipette',
  'box',
  'leaflet',
  'other',
];

const SECONDARY_TYPES: ComponentType[] = [...SECONDARY_COMPONENT_TYPES];

export type ComponentsViewKind = 'primary' | 'secondary';

interface Props {
  kind?: ComponentsViewKind;
}

const Components: React.FC<Props> = ({ kind = 'primary' }) => {
  const t = useT();
  const TYPES = kind === 'secondary' ? SECONDARY_TYPES : PRIMARY_TYPES;
  const defaultType: ComponentType = kind === 'secondary' ? 'outer_carton' : 'other';
  const heading = kind === 'secondary' ? t.outerPackaging : t.components;
  const prefsKey = kind === 'secondary' ? 'outerPackaging' : 'components';
  const [items, setItems] = useState<PackagingComponent[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Partial<PackagingComponent> | null>(null);
  const [editingReadOnly, setEditingReadOnly] = useState(false);
  const [modalTab, setModalTab] = useState<'basics' | 'dependencies'>('basics');
  const [confirmDelete, setConfirmDelete] = useState<PackagingComponent | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [blockedBy, setBlockedBy] = useState<string[] | null>(null);
  // Type-level default overage % for components (shared across primary &
  // secondary views); items without their own overagePct inherit it.
  const [defaultOveragePct, setDefaultOveragePct] = useState<number>(0);
  const [overageForAll, setOverageForAll] = useState<number | undefined>(undefined);
  const [confirmOverageForAll, setConfirmOverageForAll] = useState<number | null>(null);
  const [confirmResetOverageAll, setConfirmResetOverageAll] = useState(false);
  // Total components across all kinds — used for the "set for all" confirm count.
  const [totalComponents, setTotalComponents] = useState<number>(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [xlsxSummary, setXlsxSummary] = useState<ComponentsImportSummary | null>(null);
  // XLSX import: when not null, the mode-selection modal is open with this
  // mode pre-selected. The actual file pick happens in the main process after
  // the user confirms the mode.
  const [xlsxImportMode, setXlsxImportMode] = useState<RawMaterialsImportMode | null>(null);
  // Warehouse ("Magazyn") stock import: the analysis of differing items awaiting
  // the user's keep/take decision. Non-differing matches are committed silently
  // (notes only) without opening this modal.
  const [magazynAnalysis, setMagazynAnalysis] = useState<MagazynStockAnalysis | null>(null);

  const closeEditor = () => {
    setEditing(null);
    setEditingReadOnly(false);
    setModalTab('basics');
  };

  useEscapeKey(closeEditor, !!editing);
  useEscapeKey(() => setXlsxSummary(null), !!xlsxSummary);
  useEscapeKey(() => setMagazynAnalysis(null), !!magazynAnalysis);
  useEscapeKey(() => setSettingsOpen(false), settingsOpen);

  const COLUMNS: ColumnDef[] = useMemo(
    () => [
      { id: 'name', label: t.name, required: true },
      { id: 'symbol', label: t.symbol, defaultVisible: true },
      // Type is only useful for primary packaging (tube/bottle/jar/...).
      // For secondary we no longer treat the type as a meaningful axis;
      // capacity + dependencies carry the relevant information.
      ...(kind === 'primary'
        ? [{ id: 'type', label: 'Typ', defaultVisible: true } as ColumnDef]
        : []),
      { id: 'stock', label: t.stock, defaultVisible: true },
      { id: 'suppliers', label: t.suppliers, defaultVisible: true },
      { id: 'moq', label: t.moq, defaultVisible: true },
      { id: 'leadTime', label: t.leadTime, defaultVisible: false },
      { id: 'price', label: t.price, defaultVisible: true },
      { id: 'overage', label: t.overage, defaultVisible: true },
      ...(kind === 'secondary'
        ? [
            { id: 'capacity', label: t.packingCapacity, defaultVisible: true } as ColumnDef,
            { id: 'consumes', label: t.componentDependencies, defaultVisible: true } as ColumnDef,
          ]
        : []),
      { id: 'currency', label: t.currency, defaultVisible: false },
      { id: 'notes', label: t.notes, defaultVisible: false },
    ],
    [t, kind],
  );
  const {
    isVisible,
    toggle,
    reorder,
    reset: resetColumns,
    orderedColumns,
    orderedVisibleIds,
  } = useColumnPrefs(prefsKey, COLUMNS);

  const headerFor = (id: string): React.ReactNode => {
    switch (id) {
      case 'name':
        return <th key={id} className="col-w-lg">{t.name}</th>;
      case 'symbol':
        return <th key={id} className="col-w-md">{t.symbol}</th>;
      case 'stock':
        return <th key={id} className="num col-w-md">{t.stock}</th>;
      case 'type':
        return <th key={id} className="col-w-sm">Typ</th>;
      case 'suppliers':
        return <th key={id} className="col-w-xl">{t.suppliers}</th>;
      case 'moq':
        return <th key={id} className="num col-w-sm">{t.moq}</th>;
      case 'leadTime':
        return <th key={id} className="num col-w-sm">{t.leadTime}</th>;
      case 'price':
        return <th key={id} className="num col-w-sm">{t.price}</th>;
      case 'overage':
        return <th key={id} className="num col-w-sm">{t.overage}</th>;
      case 'capacity':
        return <th key={id} className="num col-w-sm">{t.packingCapacity}</th>;
      case 'consumes':
        return <th key={id} className="num col-w-sm">{t.componentDependencies}</th>;
      case 'currency':
        return <th key={id} className="col-w-sm">{t.currency}</th>;
      case 'notes':
        return <th key={id} className="col-w-lg">{t.notes}</th>;
      default:
        return null;
    }
  };

  const openPreview = (c: PackagingComponent) => {
    setEditingReadOnly(true);
    setModalTab('basics');
    setEditing(c);
  };

  const cellFor = (id: string, c: PackagingComponent): React.ReactNode => {
    switch (id) {
      case 'name':
        return (
          <td key={id} className="col-name col-wrap">
            <button
              type="button"
              className="link-button"
              onClick={() => openPreview(c)}
              title={t.preview}
            >
              {c.name}
            </button>
          </td>
        );
      case 'symbol':
        return <td key={id}>{c.mpFirmaSymbol ?? ''}</td>;
      case 'stock':
        return (
          <StockCell
            key={id}
            qty={c.stockQty}
            unit={t.unitUnits}
            source={c.stockSource}
            updatedAt={c.stockUpdatedAt}
            sourceFile={c.stockSourceFile}
            note={c.stockNote}
            onCommit={(q) => onSetStock(c.id, q)}
          />
        );
      case 'type':
        return <td key={id}>{c.type}</td>;
      case 'suppliers':
        return <td key={id} className="col-wrap">{renderSupplierChips(c)}</td>;
      case 'moq':
        return <td key={id} className="num">{c.moq ?? ''}</td>;
      case 'leadTime':
        return <td key={id} className="num">{c.leadTimeDays ?? ''}</td>;
      case 'price':
        return <td key={id} className="num">{c.lastPurchasePriceNet ?? ''}</td>;
      case 'overage':
        return (
          <OverageCell
            key={id}
            pct={c.overagePct}
            defaultPct={defaultOveragePct}
            onCommit={(pct) => onSetOverage(c.id, pct)}
          />
        );
      case 'capacity':
        return (
          <td key={id} className="num">
            {c.capacity !== undefined
              ? `${c.capacity.toLocaleString()} ${
                  (c.capacityUnit ?? 'units') === 'units'
                    ? t.unitUnits
                    : c.capacityUnit
                }`
              : ''}
          </td>
        );
      case 'consumes': {
        const deps = c.dependencies ?? [];
        if (deps.length === 0) {
          return <td key={id} className="num"><span className="hint">0</span></td>;
        }
        return (
          <td key={id} className="num">
            <HoverTooltip
              align="right"
              triggerClassName="count-bubble"
              trigger={deps.length}
            >
              <div className="shortage-tooltip-header">
                {t.componentDependencies} — {deps.length}
              </div>
              <ul className="shortage-tooltip-list">
                {deps.map((d, i) => {
                  const target = items.find((x) => x.id === d.componentId);
                  if (!target) return null;
                  const unit = target.capacityUnit ?? 'units';
                  const unitLabel = unit === 'units' ? t.unitUnits : unit;
                  return (
                    <li key={`${d.componentId}-${i}`}>
                      <span className="shortage-tooltip-name">{target.name}</span>
                      <span className="list-tooltip-amount">
                        {d.consumption.toLocaleString()} {unitLabel}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </HoverTooltip>
          </td>
        );
      }
      case 'currency':
        return <td key={id}>{c.currency ?? ''}</td>;
      case 'notes':
        return <td key={id} className="col-wrap">{c.notes ?? ''}</td>;
      default:
        return null;
    }
  };

  const reload = async () => {
    const [list, ss, s] = await Promise.all([
      window.electronAPI.listComponents(),
      window.electronAPI.listSuppliers(),
      window.electronAPI.getSettings(),
    ]);
    // The catalog is split by kind so each view shows only its own
    // components — keeps primary (tuba/etykieta/…) and secondary (karton
    // zbiorczy/taśma/beczka/…) separate for cleaner management.
    const matchesKind = (c: PackagingComponent) =>
      kind === 'secondary' ? isSecondaryComponent(c.type) : !isSecondaryComponent(c.type);
    setItems(list.filter(matchesKind));
    setTotalComponents(list.length);
    setSuppliers(ss);
    setDefaultOveragePct(s.defaultOveragePctComponent);
  };

  const onChangeDefaultOverage = async (v: number | undefined) => {
    const next = v ?? 0;
    setDefaultOveragePct(next);
    const updated: AppSettings = await window.electronAPI.updateSettings({
      defaultOveragePctComponent: next,
    });
    setDefaultOveragePct(updated.defaultOveragePctComponent);
  };

  // Per-item overage edit from the grid. `undefined` clears it → inherit default.
  const onSetOverage = async (id: string, pct: number | undefined) => {
    setError(null);
    try {
      await window.electronAPI.updateComponent(id, { overagePct: pct });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Applies to ALL components (both primary & secondary), matching the shared
  // component default.
  const onSetOverageForAll = async (pct: number) => {
    setConfirmOverageForAll(null);
    setError(null);
    setInfo(null);
    try {
      const n = await window.electronAPI.setOveragePctForAll('component', pct);
      setInfo(t.overageSetForAllDone.replace('{n}', String(n)));
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // Clear the explicit overage on every component → all inherit the default.
  const onResetOverageForAll = async () => {
    setConfirmResetOverageAll(false);
    setError(null);
    setInfo(null);
    try {
      const n = await window.electronAPI.setOveragePctForAll('component', null);
      setInfo(t.overageResetAllDone.replace('{n}', String(n)));
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSetStock = async (id: string, qty: number) => {
    setError(null);
    try {
      await window.electronAPI.setManualStock('component', id, qty);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
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
  }, [kind]);

  const supplierName = (id?: string) => suppliers.find((s) => s.id === id)?.name ?? '—';

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    return items.filter((c) => {
      const supplierNames = (c.supplierIds ?? [])
        .map((id) => suppliers.find((s) => s.id === id)?.name ?? '')
        .join(' ');
      return matchesQuery({ ...c, supplierNames }, query);
    });
  }, [items, suppliers, query]);

  const onAdd = () =>
    setEditing({
      name: '',
      type: defaultType,
      supplierIds: [],
      // defaultType for secondary is 'outer_carton' → 'units'. If the user
      // picks 'barrel' from the type dropdown, the unit dropdown in the modal
      // lets them switch to 'l'.
      ...(kind === 'secondary' ? { capacityUnit: 'units' as const, dependencies: [] } : {}),
    });

  // Build the same payload that onSave persists — extracted so doPropagate can
  // save the component first (it can't call onSave because that closes the
  // modal).
  const buildEditingPayload = (e: Partial<PackagingComponent>) => ({
    name: (e.name ?? '').trim(),
    type: (e.type ?? defaultType) as ComponentType,
    mpFirmaSymbol: e.mpFirmaSymbol?.trim() || undefined,
    supplierIds: e.supplierIds ?? [],
    preferredSupplierId: e.preferredSupplierId,
    moq: e.moq,
    leadTimeDays: e.leadTimeDays,
    lastPurchasePriceNet: e.lastPurchasePriceNet,
    currency: e.currency?.trim() || undefined,
    notes: e.notes?.trim() || undefined,
    overagePct: e.overagePct,
    // Only meaningful for secondary kind. Wipe on primary so a user toggling
    // a row from secondary → primary doesn't leave dangling values.
    capacity: kind === 'secondary' ? e.capacity : undefined,
    capacityUnit:
      kind === 'secondary' ? e.capacityUnit ?? 'units' : undefined,
    dependencies: kind === 'secondary' ? (e.dependencies ?? []) : undefined,
  });

  const onSave = async () => {
    if (!editing || !editing.name?.trim()) return;
    setError(null);
    const payload = buildEditingPayload(editing);
    try {
      if (editing.id) {
        await window.electronAPI.updateComponent(editing.id, payload);
      } else {
        await window.electronAPI.createComponent(payload);
      }
      setEditing(null);
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
      const { content, filename } = exportComponentsCsv(items, suppliers);
      await saveFile(filename, content, 'csv');
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
      const r = await openFile('csv');
      if (!r.ok || !r.content) return;
      try {
        const stats = await importComponentsCsv(r.content, [...items], suppliers);
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

  const runImportXlsx = async (mode: RawMaterialsImportMode) => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
    try {
      const res = await window.electronAPI.importComponentsXlsx(mode);
      // User canceling the OS file picker returns ok:false with no error.
      if (res.ok && res.summary) {
        setXlsxSummary(res.summary);
        setXlsxImportMode(null);
        await reload();
      } else {
        setXlsxImportMode(null);
        if (res.error) setError(`${t.componentsImportFailed}: ${res.error}`);
      }
    } catch (err) {
      setError(`${t.componentsImportFailed}: ${(err as Error).message}`);
      setXlsxImportMode(null);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onConfirmImportXlsx = async () => {
    if (!xlsxImportMode) return;
    await runImportXlsx(xlsxImportMode);
  };

  // When the list is empty, merge and overwrite are equivalent — skip the
  // dialog and import straight away.
  const onClickImportXlsx = () => {
    if (items.length === 0) {
      void runImportXlsx('merge');
    } else {
      setXlsxImportMode('merge');
    }
  };

  // Commit a set of Magazyn decisions and report the outcome. `actionFor`
  // resolves each differing item's keep/take choice; `createNames` is the set of
  // unmatched file rows the user chose to add as new components.
  const commitMagazyn = async (
    analysis: MagazynStockAnalysis,
    actionFor: (itemId: string) => 'keep' | 'take',
    createNames: Set<string>,
  ) => {
    const decisions: MagazynStockDecision[] = analysis.matches.map((m) => ({
      itemId: m.itemId,
      action: m.differs ? actionFor(m.itemId) : 'keep',
      importedQty: m.importedQty,
      note: m.note,
    }));
    const createItems = analysis.unmatched.filter((u) => createNames.has(u.name));
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
    try {
      const res = await window.electronAPI.commitMagazynStock({
        sourceFile: analysis.sourceFile,
        decisions,
        createItems,
      });
      let msg = t.magazynStockSummary
        .replace('{stock}', String(res.stockUpdated))
        .replace('{notes}', String(res.notesUpdated))
        .replace('{kept}', String(res.kept));
      if (res.created > 0) {
        msg += ' ' + t.magazynStockSummaryCreated.replace('{n}', String(res.created));
      }
      const ignored =
        analysis.unmatched.length - createItems.length + analysis.ambiguousNames.length;
      if (ignored > 0) {
        msg += ' ' + t.magazynStockSummaryIgnored.replace('{n}', String(ignored));
      }
      setInfo(msg);
      await reload();
    } catch (err) {
      setError(`${t.magazynStockImportFailed}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const onClickImportMagazyn = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.loaderImporting);
    let analysis: MagazynStockAnalysis | null = null;
    try {
      const res = await window.electronAPI.analyzeMagazynStock();
      // User canceled the OS file picker → ok:false with no error.
      if (!res.ok) {
        if (res.error) setError(`${t.magazynStockImportFailed}: ${res.error}`);
        return;
      }
      analysis = res.analysis ?? null;
    } catch (err) {
      setError(`${t.magazynStockImportFailed}: ${(err as Error).message}`);
      return;
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
    if (!analysis || (analysis.matches.length === 0 && analysis.unmatched.length === 0)) {
      setInfo(t.magazynStockNoMatches);
      return;
    }
    // A decision is needed when some matched item differs OR there are
    // unmatched rows to create/ignore. Otherwise apply notes straight away.
    if (analysis.matches.some((m) => m.differs) || analysis.unmatched.length > 0) {
      setMagazynAnalysis(analysis);
    } else {
      await commitMagazyn(analysis, () => 'keep', new Set());
    }
  };

  const onApplyMagazyn = async (
    actions: Map<string, 'keep' | 'take'>,
    createNames: Set<string>,
  ) => {
    const analysis = magazynAnalysis;
    if (!analysis) return;
    setMagazynAnalysis(null);
    await commitMagazyn(analysis, (id) => actions.get(id) ?? 'keep', createNames);
  };

  const onDelete = async (c: PackagingComponent) => {
    setConfirmDelete(null);
    const result = await window.electronAPI.deleteComponent(c.id);
    if (!result.ok) {
      setBlockedBy(result.blockedBy ?? []);
    } else {
      await reload();
    }
  };

  const onDeleteAll = async () => {
    setConfirmDeleteAll(false);
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.deleteAllInProgress);
    const total = items.length;
    let deleted = 0;
    let blocked = 0;
    const blockers: string[] = [];
    try {
      for (const c of items) {
        const result = await window.electronAPI.deleteComponent(c.id);
        if (result.ok) deleted++;
        else {
          blocked++;
          if (result.blockedBy) blockers.push(...result.blockedBy);
        }
      }
      if (blocked === 0) {
        setInfo(t.deleteAllSuccess.replace('{n}', String(deleted)));
      } else {
        setInfo(
          t.deleteAllPartial
            .replace('{n}', String(deleted))
            .replace('{total}', String(total))
            .replace('{blocked}', String(blocked)),
        );
        setBlockedBy(Array.from(new Set(blockers)));
      }
      await reload();
    } finally {
      setBusy(false);
      setLoaderMessage(null);
    }
  };

  const renderSupplierChips = (c: PackagingComponent) => {
    const ids = c.supplierIds ?? [];
    if (ids.length === 0) return <span className="hint">—</span>;
    const ordered = [
      ...(c.preferredSupplierId && ids.includes(c.preferredSupplierId)
        ? [c.preferredSupplierId]
        : []),
      ...ids.filter((id) => id !== c.preferredSupplierId),
    ];
    return (
      <span className="supplier-chips">
        {ordered.map((id) => {
          const isPreferred = id === c.preferredSupplierId;
          return (
            <span
              key={id}
              className={`supplier-chip ${isPreferred ? 'preferred' : ''}`}
              title={isPreferred ? t.preferredSupplier : undefined}
            >
              {isPreferred && (
                <span className="supplier-chip-star">
                  <IconStar size={11} />
                </span>
              )}
              {supplierName(id)}
            </span>
          );
        })}
      </span>
    );
  };

  return (
    <div className="main">
      <div className="page-header">
        <HeaderNav />
        <h1>{heading}</h1>
        <span className="page-header-count">{items.length}</span>
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => setSettingsOpen(true)}
          title={t.settings}
          aria-label={t.settings}
        >
          <IconSettings size={14} />
        </button>
      </div>

      <div className="card">
        <div className="toolbar">
          <div className="toolbar-actions">
            <ExportImportButtons
              format="csv"
              onExport={onExport}
              onImport={onImport}
              busy={busy}
            />
            <button
              className="btn btn-import"
              onClick={onClickImportXlsx}
              disabled={busy}
              title={t.componentsImportXlsxHint}
            >
              <IconImport size={13} /> {t.componentsImportXlsx}
            </button>
            <button
              className="btn btn-import"
              onClick={onClickImportMagazyn}
              disabled={busy}
              title={t.magazynStockImportHint}
            >
              <IconImport size={13} /> {t.magazynStockImport}
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
              {filtered.map((c) => (
                <tr key={c.id}>
                  {orderedVisibleIds.map((id) => cellFor(id, c))}
                  <td className="actions actions-sticky">
                    <div className="btn-row">
                      <button
                        className="btn btn-sm soft-edit"
                        onClick={() => {
                          setEditingReadOnly(false);
                          setModalTab('basics');
                          setEditing(c);
                        }}
                        title={t.edit}
                      >
                        <IconEdit size={13} /> {t.edit}
                      </button>
                      <button
                        className="btn btn-sm soft-success"
                        onClick={async () => {
                          await window.electronAPI.duplicateComponent(c.id);
                          await reload();
                        }}
                        title={t.duplicate}
                      >
                        <IconDuplicate size={13} /> {t.duplicate}
                      </button>
                      <button
                        className="btn btn-sm soft-danger"
                        onClick={() => setConfirmDelete(c)}
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
        <div
          className="modal-overlay"
          onClick={closeEditor}
        >
          <div
            className={`modal modal-md${editingReadOnly ? ' modal-readonly' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <ModalHeader
              icon={
                editingReadOnly ? (
                  <IconEye size={18} />
                ) : editing.id ? (
                  <IconEdit size={18} />
                ) : (
                  <IconPlus size={18} />
                )
              }
              tone={editingReadOnly ? 'edit' : editing.id ? 'edit' : 'add'}
              title={
                editingReadOnly
                  ? `${t.preview}: ${editing.name ?? ''}`
                  : editing.id
                    ? `${t.edit}: ${editing.name ?? ''}`
                    : `${t.add} — ${heading.toLowerCase()}`
              }
              onClose={closeEditor}
            />
            <div className="modal-body">
            {kind === 'secondary' && (
              <div className="modal-tabs">
                <button
                  type="button"
                  className={`modal-tab ${modalTab === 'basics' ? 'active' : ''}`}
                  onClick={() => setModalTab('basics')}
                >
                  <span>{t.productTabBasics}</span>
                </button>
                <button
                  type="button"
                  className={`modal-tab ${modalTab === 'dependencies' ? 'active' : ''}`}
                  onClick={() => setModalTab('dependencies')}
                >
                  <span>{t.componentDependencies}</span>
                  <span className="modal-tab-count">{editing.dependencies?.length ?? 0}</span>
                </button>
                <div className="modal-tabs-spacer" />
              </div>
            )}
            {(kind !== 'secondary' || modalTab === 'basics') && (<>
            <div className="form-row">
              <label>{t.name}</label>
              <input
                className="input"
                value={editing.name ?? ''}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                disabled={editingReadOnly}
              />
            </div>
            {kind === 'secondary' && (
              <>
                <div className="form-row">
                  <label>{t.packingCapacity}</label>
                  <NumberInput
                    className="input"
                    value={editing.capacity}
                    onChange={(v) => setEditing({ ...editing, capacity: v })}
                    disabled={editingReadOnly}
                  />
                </div>
                <div className="form-row">
                  <label>{t.packingCapacityUnit}</label>
                  <select
                    className="input"
                    value={editing.capacityUnit ?? 'units'}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        capacityUnit: e.target.value as PackingCapacityUnit,
                      })
                    }
                    disabled={editingReadOnly}
                  >
                    <option value="units">{t.unitUnits}</option>
                    <option value="m">m</option>
                    <option value="kg">kg</option>
                    <option value="l">l</option>
                  </select>
                </div>
              </>
            )}
            {kind === 'primary' && (
              <div className="form-row">
                <label>Typ</label>
                <SearchableSelect
                  options={TYPES.map((tt) => ({ value: tt, label: tt }))}
                  value={editing.type ?? 'other'}
                  onChange={(val) => setEditing({ ...editing, type: val as ComponentType })}
                  disabled={editingReadOnly}
                />
              </div>
            )}
            <div className="form-row">
              <label>{t.symbol}</label>
              <input
                className="input"
                value={editing.mpFirmaSymbol ?? ''}
                onChange={(e) => setEditing({ ...editing, mpFirmaSymbol: e.target.value })}
                disabled={editingReadOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.suppliers}</label>
              <SupplierMultiPicker
                suppliers={suppliers.filter((s) => s.type !== 'raw')}
                selectedIds={editing.supplierIds ?? []}
                preferredId={editing.preferredSupplierId}
                onChange={(ids, pref) =>
                  setEditing({ ...editing, supplierIds: ids, preferredSupplierId: pref })
                }
              />
            </div>
            <div className="form-row">
              <label>{t.moq}</label>
              <NumberInput
                className="input"
                value={editing.moq}
                onChange={(v) => setEditing({ ...editing, moq: v })}
                disabled={editingReadOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.leadTime}</label>
              <NumberInput
                className="input"
                value={editing.leadTimeDays}
                onChange={(v) => setEditing({ ...editing, leadTimeDays: v })}
                disabled={editingReadOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.price}</label>
              <NumberInput
                className="input"
                step="0.01"
                value={editing.lastPurchasePriceNet}
                onChange={(v) => setEditing({ ...editing, lastPurchasePriceNet: v })}
                disabled={editingReadOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.currency}</label>
              <input
                className="input"
                placeholder="PLN"
                value={editing.currency ?? ''}
                onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
                disabled={editingReadOnly}
              />
            </div>
            <div className="form-row">
              <label>{t.overage} (%)</label>
              <NumberInput
                className="input"
                step="0.1"
                value={editing.overagePct}
                placeholder={String(defaultOveragePct)}
                onChange={(v) => setEditing({ ...editing, overagePct: v })}
                disabled={editingReadOnly}
              />
            </div>
            <div className="hint" style={{ marginTop: -4, marginBottom: 8 }}>
              {t.overageInheritHint.replace('{n}', String(defaultOveragePct))}
            </div>
            <div className="form-row">
              <label>{t.notes}</label>
              <textarea
                value={editing.notes ?? ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                disabled={editingReadOnly}
              />
            </div>
            </>)}
            {kind === 'secondary' && modalTab === 'dependencies' && (
              <DependenciesEditor
                editing={editing}
                allComponents={items}
                onChange={(deps) => setEditing({ ...editing, dependencies: deps })}
                onOpenComponent={(c) => {
                  // Stay in modal, just swap the entity being edited.
                  setEditingReadOnly(true);
                  setModalTab('basics');
                  setEditing(c);
                }}
                readOnly={editingReadOnly}
                t={t}
              />
            )}
            </div>
            <div className="modal-footer">
              {editingReadOnly ? (
                <button className="btn primary-filled" onClick={closeEditor}>
                  {t.close}
                </button>
              ) : (
                <>
                  <button className="btn" onClick={closeEditor}>
                    {t.cancel}
                  </button>
                  <button className="btn primary-filled" onClick={onSave}>
                    {t.save}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
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

      {xlsxImportMode !== null && (
        <ComponentsImportModeDialog
          mode={xlsxImportMode}
          onChange={setXlsxImportMode}
          onCancel={() => setXlsxImportMode(null)}
          onConfirm={onConfirmImportXlsx}
          busy={busy}
        />
      )}

      {xlsxSummary && (
        <ComponentsXlsxImportSummaryModal
          summary={xlsxSummary}
          onClose={() => setXlsxSummary(null)}
        />
      )}

      {magazynAnalysis && (
        <MagazynStockDiffModal
          analysis={magazynAnalysis}
          onCancel={() => setMagazynAnalysis(null)}
          onApply={onApplyMagazyn}
        />
      )}

      {blockedBy && (
        <BlockedByDialog blockedBy={blockedBy} onClose={() => setBlockedBy(null)} />
      )}

      {confirmOverageForAll !== null && (
        <ConfirmDialog
          message={t.overageSetForAllConfirm
            .replace('{pct}', String(confirmOverageForAll))
            .replace('{n}', String(totalComponents))}
          onConfirm={() => onSetOverageForAll(confirmOverageForAll)}
          onCancel={() => setConfirmOverageForAll(null)}
        />
      )}

      {confirmResetOverageAll && (
        <ConfirmDialog
          message={t.overageResetAllConfirm.replace('{n}', String(totalComponents))}
          onConfirm={onResetOverageForAll}
          onCancel={() => setConfirmResetOverageAll(false)}
        />
      )}

      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <ModalHeader
              icon={<IconSettings size={18} />}
              tone="edit"
              title={t.settings}
              onClose={() => setSettingsOpen(false)}
            />
            <div className="modal-body">
              <div className="form-row">
                <label>{t.overageDefaultComponent}</label>
                <NumberInput
                  className="input"
                  step="0.1"
                  value={defaultOveragePct}
                  emptyValue={0}
                  onChange={onChangeDefaultOverage}
                />
              </div>
              <div className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
                {t.overageInheritHint.replace('{n}', String(defaultOveragePct))}
              </div>
              <div className="form-row">
                <label>{t.overageSetForAll}</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <NumberInput
                    className="input"
                    step="0.1"
                    value={overageForAll}
                    placeholder={String(defaultOveragePct)}
                    onChange={setOverageForAll}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={overageForAll === undefined}
                    onClick={() =>
                      overageForAll !== undefined && setConfirmOverageForAll(overageForAll)
                    }
                  >
                    {t.overageSetForAll}
                  </button>
                </div>
              </div>
              <div className="hint" style={{ marginTop: -4, marginBottom: 12 }}>
                {t.overageSetForAllHint}
              </div>
              <div className="form-row">
                <label>{t.overageResetAll}</label>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setConfirmResetOverageAll(true)}
                >
                  {t.overageResetAll}
                </button>
              </div>
              <div className="hint" style={{ marginTop: -4 }}>
                {t.overageResetAllHint}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn primary-filled" onClick={() => setSettingsOpen(false)}>
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {loaderMessage && <LoadingOverlay message={loaderMessage} />}
    </div>
  );
};

// ---------- Cross-component dependencies editor ----------
//
// Rendered inside the secondary-component modal. Lets the user say "1 of
// THIS component consumes N of <other secondary>". Cascading consumption
// is computed by the back-end calculators on every cost/shortage/maxProducible
// pass. The form does:
//   - prevents self-reference (a carton can't depend on itself)
//   - filters the picker to other secondary components only
//   - shows "1 [this] → N [unit-of-dep]" hint per row
//
// Cycle detection at scheme-walk time (in packingConsumption.ts) is a safety
// net; we should also reject cycles on save, but for now a single-step user
// can already form one A→B→A pair — flagged here only via a faint warning
// when we notice an existing back-edge. Forbidden cycle save can be added
// later if it becomes a real issue.
interface DependenciesEditorProps {
  editing: Partial<PackagingComponent>;
  allComponents: PackagingComponent[];
  onChange: (next: ComponentDependency[]) => void;
  onOpenComponent?: (c: PackagingComponent) => void;
  readOnly?: boolean;
  t: ReturnType<typeof useT>;
}

const DependenciesEditor: React.FC<DependenciesEditorProps> = ({
  editing,
  allComponents,
  onChange,
  onOpenComponent,
  readOnly = false,
  t,
}) => {
  const deps = editing.dependencies ?? [];

  const availableOptions = useMemo(() => {
    return allComponents
      .filter(
        (c) =>
          isSecondaryComponent(c.type) &&
          c.id !== editing.id &&
          !deps.some((d) => d.componentId === c.id),
      )
      .map((c) => ({
        value: c.id,
        label: c.name,
        hint: c.capacityUnit ?? 'units',
      }));
  }, [allComponents, editing.id, deps]);

  const componentById = useMemo(
    () => new Map(allComponents.map((c) => [c.id, c])),
    [allComponents],
  );

  const update = (idx: number, patch: Partial<ComponentDependency>) => {
    const next = deps.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const remove = (idx: number) => onChange(deps.filter((_, i) => i !== idx));

  const add = () => {
    if (availableOptions.length === 0) return;
    onChange([
      ...deps,
      { componentId: availableOptions[0].value, consumption: 1 },
    ]);
  };

  return (
    <div>
      <div className="hint" style={{ fontSize: 12, marginBottom: 10 }}>
        {t.componentDependenciesHint}
      </div>
      {!readOnly && (
        <div className="row" style={{ marginBottom: 12 }}>
          <div className="spacer" />
          <button
            className="btn btn-sm soft-edit"
            onClick={add}
            disabled={availableOptions.length === 0}
          >
            <IconPlus size={13} /> {t.add}
          </button>
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>{t.componentDependenciesConsumed}</th>
            <th className="num">{t.componentDependenciesAmount}</th>
            <th>{t.unit}</th>
            {!readOnly && <th className="actions">{t.actionsHeader}</th>}
          </tr>
        </thead>
        <tbody>
          {deps.length === 0 && (
            <tr>
              <td colSpan={readOnly ? 3 : 4} className="hint">
                {t.noData}
              </td>
            </tr>
          )}
          {deps.map((dep, idx) => {
            const depComp = componentById.get(dep.componentId);
            const depUnit = depComp?.capacityUnit ?? 'units';
            const unitLabel = depUnit === 'units' ? t.unitUnits : depUnit;
            return (
              <tr key={idx}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <SearchableSelect
                        options={[
                          ...(depComp
                            ? [
                                {
                                  value: depComp.id,
                                  label: depComp.name,
                                  hint: depComp.capacityUnit ?? 'units',
                                },
                              ]
                            : []),
                          ...availableOptions,
                        ]}
                        value={dep.componentId}
                        onChange={(val) => update(idx, { componentId: val })}
                        disabled={readOnly}
                      />
                    </div>
                    {depComp && onOpenComponent && (
                      <button
                        type="button"
                        className="btn btn-sm btn-icon-only"
                        onClick={() => onOpenComponent(depComp)}
                        title={t.preview}
                      >
                        <IconEye size={13} />
                      </button>
                    )}
                  </div>
                </td>
                <td className="num">
                  <NumberInput
                    className="input"
                    style={{ width: 110 }}
                    value={dep.consumption}
                    emptyValue={0}
                    onChange={(v) => update(idx, { consumption: v ?? 0 })}
                    disabled={readOnly}
                  />
                </td>
                <td>
                  <span className="hint">{unitLabel}</span>
                </td>
                {!readOnly && (
                  <td className="actions">
                    <button
                      className="btn btn-sm soft-danger btn-icon-only"
                      onClick={() => remove(idx)}
                      title={t.delete}
                    >
                      <IconClose size={12} />
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ---------- XLSX import: mode picker ----------

interface ComponentsModeDialogProps {
  mode: RawMaterialsImportMode;
  onChange: (m: RawMaterialsImportMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
  busy: boolean;
}

const ComponentsImportModeDialog: React.FC<ComponentsModeDialogProps> = ({
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
          title={t.componentsImportDialogTitle}
          onClose={onCancel}
        />
        <div className="modal-body">
          <label className="form-row" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="radio"
              name="comp-import-mode"
              checked={mode === 'merge'}
              onChange={() => onChange('merge')}
              disabled={busy}
              style={{ marginTop: 4 }}
            />
            <div style={{ marginLeft: 8 }}>
              <strong>{t.componentsImportModeMerge}</strong>
              <div className="hint" style={{ marginTop: 4 }}>
                {t.componentsImportModeMergeDesc}
              </div>
            </div>
          </label>
          <label className="form-row" style={{ alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="radio"
              name="comp-import-mode"
              checked={mode === 'overwrite'}
              onChange={() => onChange('overwrite')}
              disabled={busy}
              style={{ marginTop: 4 }}
            />
            <div style={{ marginLeft: 8 }}>
              <strong>{t.componentsImportModeOverwrite}</strong>
              <div className="hint" style={{ marginTop: 4 }}>
                {t.componentsImportModeOverwriteDesc}
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
            {t.componentsImportConfirm}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ComponentsXlsxSummaryModalProps {
  summary: ComponentsImportSummary;
  onClose: () => void;
}

const ComponentsXlsxImportSummaryModal: React.FC<ComponentsXlsxSummaryModalProps> = ({
  summary,
  onClose,
}) => {
  const t = useT();
  useEscapeKey(onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconImport size={18} />}
          tone="add"
          title={t.componentsImportSummary}
          onClose={onClose}
        />
        <div className="modal-body">
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>
              {t.componentsImportComponentsCreated}: <strong>{summary.componentsCreated}</strong>
            </li>
            <li>
              {t.componentsImportComponentsUpdated}: <strong>{summary.componentsUpdated}</strong>
            </li>
            {summary.componentsSkipped > 0 && (
              <li>
                {t.componentsImportComponentsSkipped}: <strong>{summary.componentsSkipped}</strong>
              </li>
            )}
            {summary.componentsDeleted > 0 && (
              <li>
                {t.componentsImportComponentsDeleted}: <strong>{summary.componentsDeleted}</strong>
              </li>
            )}
            <li>
              {t.componentsImportSuppliersCreated}: <strong>{summary.suppliersCreated}</strong>
            </li>
            <li>
              {t.componentsImportSuppliersUpdated}: <strong>{summary.suppliersUpdated}</strong>
            </li>
          </ul>
          {summary.warnings.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 6 }}>
                <strong>{t.componentsImportWarnings}</strong> ({summary.warnings.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.5 }}>
                {summary.warnings.slice(0, 20).map((w, i) => (
                  <li key={i} className="hint">
                    {w}
                  </li>
                ))}
                {summary.warnings.length > 20 && (
                  <li className="hint">… +{summary.warnings.length - 20}</li>
                )}
              </ul>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn primary-filled" onClick={onClose}>
            <IconClose size={13} /> {t.close}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------- Warehouse ("Magazyn") stock import decisions ----------
//
// Two decision groups, either of which may be empty:
//   * matched items whose Excel stock differs from the catalog → keep / take;
//   * unmatched file rows (not in the catalog) → create as a new component /
//     ignore.
// Both support per-row and bulk actions. Notes (column E) are applied on the
// back-end for every matched item regardless of the keep/take choice.

interface MagazynStockDiffModalProps {
  analysis: MagazynStockAnalysis;
  onCancel: () => void;
  onApply: (actions: Map<string, 'keep' | 'take'>, createNames: Set<string>) => void;
}

const MagazynStockDiffModal: React.FC<MagazynStockDiffModalProps> = ({
  analysis,
  onCancel,
  onApply,
}) => {
  const t = useT();
  useEscapeKey(onCancel);
  const diffs = useMemo(() => analysis.matches.filter((m) => m.differs), [analysis]);
  const unmatched = analysis.unmatched;
  // Default to taking the Excel value — that's the intent of running an import.
  const [actions, setActions] = useState<Map<string, 'keep' | 'take'>>(
    () => new Map(diffs.map((m) => [m.itemId, 'take' as const])),
  );
  // Unmatched rows default to ignore; the user opts them in to create.
  const [createSet, setCreateSet] = useState<Set<string>>(new Set());

  const setAll = (action: 'keep' | 'take') =>
    setActions(new Map(diffs.map((m) => [m.itemId, action])));
  const setOne = (id: string, action: 'keep' | 'take') =>
    setActions((prev) => new Map(prev).set(id, action));
  const setCreateAll = (create: boolean) =>
    setCreateSet(create ? new Set(unmatched.map((u) => u.name)) : new Set());
  const toggleCreate = (name: string) =>
    setCreateSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const fmt = (n?: number) => (n === undefined ? '—' : n.toLocaleString());

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
        <ModalHeader
          icon={<IconImport size={18} />}
          tone="add"
          title={t.magazynStockDiffTitle}
          onClose={onCancel}
        />
        <div className="modal-body">
          {diffs.length > 0 && (
            <>
              <div className="hint" style={{ marginBottom: 12 }}>
                {t.magazynStockDiffIntro}
              </div>
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <button type="button" className="btn btn-sm" onClick={() => setAll('keep')}>
                  {t.magazynStockKeepAll}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setAll('take')}>
                  {t.magazynStockTakeAll}
                </button>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.magazynStockColItem}</th>
                      <th className="num">{t.magazynStockColCurrent}</th>
                      <th className="num">{t.magazynStockColExcel}</th>
                      <th>{t.magazynStockColDecision}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((m) => {
                      const action = actions.get(m.itemId) ?? 'take';
                      return (
                        <tr key={m.itemId}>
                          <td className="col-wrap">
                            {m.name}
                            {m.note && (
                              <HoverTooltip
                                align="left"
                                triggerClassName="stock-note-icon"
                                trigger={<IconInfo size={12} />}
                              >
                                <div className="shortage-tooltip-header">{t.stockNote}</div>
                                <div className="stock-note-text">{m.note}</div>
                              </HoverTooltip>
                            )}
                          </td>
                          <td className="num">{fmt(m.currentQty)}</td>
                          <td className="num">{fmt(m.importedQty)}</td>
                          <td>
                            <div className="btn-row">
                              <button
                                type="button"
                                className={`btn btn-sm ${action === 'keep' ? 'primary-filled' : ''}`}
                                onClick={() => setOne(m.itemId, 'keep')}
                              >
                                {t.magazynStockKeep}
                              </button>
                              <button
                                type="button"
                                className={`btn btn-sm ${action === 'take' ? 'primary-filled' : ''}`}
                                onClick={() => setOne(m.itemId, 'take')}
                              >
                                {t.magazynStockTake}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {unmatched.length > 0 && (
            <>
              <div
                className="hint"
                style={{ marginBottom: 12, marginTop: diffs.length > 0 ? 20 : 0 }}
              >
                {t.magazynStockUnmatchedIntro.replace('{n}', String(unmatched.length))}
              </div>
              <div className="row" style={{ gap: 8, marginBottom: 12 }}>
                <button type="button" className="btn btn-sm" onClick={() => setCreateAll(false)}>
                  {t.magazynStockIgnoreAll}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setCreateAll(true)}>
                  {t.magazynStockCreateAll}
                </button>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t.magazynStockColItem}</th>
                      <th className="num">{t.magazynStockColExcel}</th>
                      <th>{t.magazynStockColDecision}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unmatched.map((u) => {
                      const create = createSet.has(u.name);
                      return (
                        <tr key={u.name}>
                          <td className="col-wrap">
                            {u.name}
                            {u.note && (
                              <HoverTooltip
                                align="left"
                                triggerClassName="stock-note-icon"
                                trigger={<IconInfo size={12} />}
                              >
                                <div className="shortage-tooltip-header">{t.stockNote}</div>
                                <div className="stock-note-text">{u.note}</div>
                              </HoverTooltip>
                            )}
                          </td>
                          <td className="num">{fmt(u.qty)}</td>
                          <td>
                            <div className="btn-row">
                              <button
                                type="button"
                                className={`btn btn-sm ${!create ? 'primary-filled' : ''}`}
                                onClick={() => create && toggleCreate(u.name)}
                              >
                                {t.magazynStockIgnore}
                              </button>
                              <button
                                type="button"
                                className={`btn btn-sm ${create ? 'primary-filled' : ''}`}
                                onClick={() => !create && toggleCreate(u.name)}
                              >
                                {t.magazynStockCreate}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            {t.cancel}
          </button>
          <button className="btn primary-filled" onClick={() => onApply(actions, createSet)}>
            {t.magazynStockApply}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Components;
