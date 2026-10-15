import React, { useEffect, useMemo, useState } from 'react';
import { useT } from '../i18n';
import { HeaderNav } from '../navigation';
import type {
  AppSettings,
  ComponentDependency,
  PackagingComponent,
  PackagingKind,
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
import SkeletonRows from '../components/SkeletonRows';
import { useMinimumLoading } from '../utils/useMinimumLoading';
import SupplierMultiPicker from '../components/SupplierMultiPicker';
import SearchInput, { matchesQuery } from '../components/SearchInput';
import SearchableSelect from '../components/SearchableSelect';
import NumberInput from '../components/NumberInput';
import StockCell from '../components/StockCell';
import PriceCell from '../components/PriceCell';
import { PriceHistoryList } from '../components/PriceHistory';
import OverageCell from '../components/OverageCell';
import ColumnPicker from '../components/ColumnPicker';
import HoverTooltip from '../components/HoverTooltip';
import { useColumnPrefs, type ColumnDef } from '../utils/useColumnPrefs';
import { useColumnResize } from '../utils/useColumnResize';
import { sortRows, type SortValue } from '../utils/sortRows';
import {
  IconEdit,
  IconTrash,
  IconPlus,
  IconStar,
  IconClose,
  IconEye,
  IconDuplicate,
  IconImport,
  IconInfo,
  IconSettings,
} from '../components/Icons';
import IconButton from '../components/IconButton';
import ModalHeader from '../components/ModalHeader';
import ExportImportButtons from '../components/ExportImportButtons';
import SegmentedControl from '../components/SegmentedControl';
import { useEscapeKey } from '../utils/useEscapeKey';
import {
  exportComponentsCsv,
  importComponentsCsv,
  saveFile,
  openFile,
  formatStats,
  ImportSaveError,
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

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// Secondary packaging without a capacity is skipped by every calculator
// (cost, shortages, max producible) — flagged in the list and the editor.
const lacksCapacity = (c: Partial<PackagingComponent>): boolean =>
  !!c.type && isSecondaryComponent(c.type) && !((c.capacity ?? 0) > 0);

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
  // The Magazyn warehouse file's sheet name this view's stock import reads —
  // see analyzeMagazynStock's `section` param.
  const magazynSheetName = kind === 'secondary' ? 'Opakowania zbiorcze' : 'Stan komponentów';
  const [items, setItems] = useState<PackagingComponent[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Partial<PackagingComponent> | null>(null);
  const [editingReadOnly, setEditingReadOnly] = useState(false);
  const [modalTab, setModalTab] = useState<'basics' | 'dependencies'>('basics');
  const [confirmDelete, setConfirmDelete] = useState<PackagingComponent | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const showSkeleton = useMinimumLoading(initialLoading);
  const [error, setError] = useState<string | null>(null);
  // A failed first load — shown in the table instead of "no data".
  const [loadError, setLoadError] = useState<string | null>(null);
  // Save error of the edit modal, shown inside it (the page banner sits under
  // the modal overlay).
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
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
    setEditError(null);
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
        ? [{ id: 'type', label: t.componentTypeLabel, defaultVisible: true } as ColumnDef]
        : []),
      { id: 'stock', label: t.stock, defaultVisible: true },
      { id: 'suppliers', label: t.suppliers, defaultVisible: true },
      { id: 'moq', label: t.moq, defaultVisible: true },
      { id: 'leadTime', label: t.leadTime, defaultVisible: false },
      { id: 'price', label: t.price, defaultVisible: true },
      { id: 'overage', label: t.overage, defaultVisible: true },
      ...(kind === 'secondary'
        ? [
            { id: 'packagingKind', label: t.packagingKind, defaultVisible: true } as ColumnDef,
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
    widths,
    setWidth,
    resetWidth,
    sort,
    toggleSort,
    orderedColumns,
    orderedVisibleIds,
  } = useColumnPrefs(prefsKey, COLUMNS);
  const { decorateHeader } = useColumnResize(setWidth, { sort, toggleSort });

  const headerFor = (id: string): React.ReactNode => {
    switch (id) {
      case 'name':
        return (
          <th key={id} className="col-w-lg">
            {t.name}
          </th>
        );
      case 'symbol':
        return (
          <th key={id} className="col-w-md">
            {t.symbol}
          </th>
        );
      case 'stock':
        return (
          <th key={id} className="num col-w-md">
            {t.stock}
          </th>
        );
      case 'type':
        return (
          <th key={id} className="col-w-sm">
            {t.componentTypeLabel}
          </th>
        );
      case 'suppliers':
        return (
          <th key={id} className="col-w-xl">
            {t.suppliers}
          </th>
        );
      case 'moq':
        return (
          <th key={id} className="num col-w-sm">
            {t.moq}
          </th>
        );
      case 'leadTime':
        return (
          <th key={id} className="num col-w-sm">
            {t.leadTime}
          </th>
        );
      case 'price':
        return (
          <th key={id} className="num col-w-sm">
            {t.price}
          </th>
        );
      case 'overage':
        return (
          <th key={id} className="num col-w-sm">
            {t.overage}
          </th>
        );
      case 'packagingKind':
        return (
          <th key={id} className="col-w-sm">
            {t.packagingKind}
          </th>
        );
      case 'capacity':
        return (
          <th key={id} className="num col-w-sm">
            {t.packingCapacity}
          </th>
        );
      case 'consumes':
        return (
          <th key={id} className="num col-w-sm">
            {t.componentDependencies}
          </th>
        );
      case 'currency':
        return (
          <th key={id} className="col-w-sm">
            {t.currency}
          </th>
        );
      case 'notes':
        return (
          <th key={id} className="col-w-lg">
            {t.notes}
          </th>
        );
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
            <HoverTooltip
              className="hover-tooltip-compact"
              trigger={
                <button type="button" className="link-button" onClick={() => openPreview(c)}>
                  {c.name}
                </button>
              }
            >
              {t.preview}
            </HoverTooltip>
            {lacksCapacity(c) && (
              <HoverTooltip
                triggerClassName="stock-note-icon stock-note-icon-warn"
                trigger={<span aria-label={t.componentNoCapacityTooltip}>⚠</span>}
              >
                <div className="shortage-tooltip-explain">{t.componentNoCapacityTooltip}</div>
              </HoverTooltip>
            )}
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
        return (
          <td key={id} className="col-wrap">
            {renderSupplierChips(c)}
          </td>
        );
      case 'moq':
        return (
          <td key={id} className="num">
            {c.moq ?? ''}
          </td>
        );
      case 'leadTime':
        return (
          <td key={id} className="num">
            {c.leadTimeDays ?? ''}
          </td>
        );
      case 'price':
        return (
          <PriceCell
            key={id}
            price={c.lastPurchasePriceNet}
            currency={c.currency}
            history={c.priceHistory}
            onCommit={(v) => onSetPrice(c.id, v)}
          />
        );
      case 'overage':
        return (
          <OverageCell
            key={id}
            pct={c.overagePct}
            defaultPct={defaultOveragePct}
            onCommit={(pct) => onSetOverage(c.id, pct)}
          />
        );
      case 'packagingKind':
        return (
          <td key={id}>
            {(c.packagingKind ?? 'product') === 'product'
              ? t.packagingKindProduct
              : t.packagingKindMass}
          </td>
        );
      case 'capacity':
        return (
          <td key={id} className="num">
            {c.capacity !== undefined
              ? `${c.capacity.toLocaleString()} ${
                  (c.capacityUnit ?? 'units') === 'units' ? t.unitUnits : c.capacityUnit
                }`
              : ''}
          </td>
        );
      case 'consumes': {
        const deps = c.dependencies ?? [];
        if (deps.length === 0) {
          return (
            <td key={id} className="num">
              <span className="hint">0</span>
            </td>
          );
        }
        return (
          <td key={id} className="num">
            <HoverTooltip align="right" triggerClassName="count-bubble" trigger={deps.length}>
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
        return (
          <td key={id} className="col-wrap">
            {c.notes ?? ''}
          </td>
        );
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

  // Swap one saved item into the list — inline edits return the updated
  // entity (always of this view's kind), so there is no need to re-fetch.
  const patchItem = (updated: PackagingComponent) =>
    setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));

  const onChangeDefaultOverage = async (v: number | undefined) => {
    const next = v ?? 0;
    const previous = defaultOveragePct;
    setDefaultOveragePct(next);
    setError(null);
    try {
      const updated: AppSettings = await window.electronAPI.updateSettings({
        defaultOveragePctComponent: next,
      });
      setDefaultOveragePct(updated.defaultOveragePctComponent);
    } catch (err) {
      setDefaultOveragePct(previous);
      setError(errorMessage(err));
    }
  };

  // Per-item overage edit from the grid. `undefined` clears it → inherit default.
  const onSetOverage = async (id: string, pct: number | undefined) => {
    setError(null);
    try {
      patchItem(await window.electronAPI.updateComponent(id, { overagePct: pct }));
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  // Inline price edit from the grid. The catalog update records the change in
  // the component's price history (see recordPriceChange in main/database.ts).
  const onSetPrice = async (id: string, price: number | undefined) => {
    setError(null);
    try {
      patchItem(
        await window.electronAPI.updateComponent(id, { lastPurchasePriceNet: price }),
      );
    } catch (err) {
      setError(errorMessage(err));
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
      const updated = await window.electronAPI.setManualStock('component', id, qty);
      patchItem(updated as PackagingComponent);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  useEffect(() => {
    void (async () => {
      // First load shows skeleton rows in the table (see SkeletonRows), not a
      // blocking overlay.
      setInitialLoading(true);
      setLoadError(null);
      try {
        await reload();
      } catch (err) {
        setLoadError(`${t.loadFailed}: ${errorMessage(err)}`);
      } finally {
        setInitialLoading(false);
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

  // Header-click sort key per column: what the cell shows, numeric where the
  // column is.
  const sortValueFor = (id: string, c: PackagingComponent): SortValue => {
    switch (id) {
      case 'name':
        return c.name;
      case 'symbol':
        return c.mpFirmaSymbol;
      case 'type':
        return c.type;
      case 'stock':
        return c.stockQty;
      case 'suppliers': {
        // The first chip shown: the preferred supplier, else the first one.
        const ids = c.supplierIds ?? [];
        const first =
          c.preferredSupplierId && ids.includes(c.preferredSupplierId)
            ? c.preferredSupplierId
            : ids[0];
        return first ? suppliers.find((s) => s.id === first)?.name : undefined;
      }
      case 'moq':
        return c.moq;
      case 'leadTime':
        return c.leadTimeDays;
      case 'price':
        return c.lastPurchasePriceNet;
      case 'overage':
        return c.overagePct ?? defaultOveragePct;
      case 'packagingKind':
        return (c.packagingKind ?? 'product') === 'product'
          ? t.packagingKindProduct
          : t.packagingKindMass;
      case 'capacity':
        return c.capacity;
      case 'consumes':
        return (c.dependencies ?? []).length;
      case 'currency':
        return c.currency;
      case 'notes':
        return c.notes;
      default:
        return undefined;
    }
  };
  const sorted = useMemo(
    () => sortRows(filtered, sort, sortValueFor),
    [filtered, sort, suppliers, defaultOveragePct, t],
  );

  const onAdd = () => {
    setEditError(null);
    setEditing({
      name: '',
      type: defaultType,
      supplierIds: [],
      // defaultType for secondary is 'outer_carton' → 'units'. If the user
      // picks 'barrel' from the type dropdown, the unit dropdown in the modal
      // lets them switch to 'l'.
      ...(kind === 'secondary'
        ? {
            capacityUnit: 'units' as const,
            packagingKind: 'product' as const,
            dependencies: [],
          }
        : {}),
    });
  };

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
    capacityUnit: kind === 'secondary' ? (e.capacityUnit ?? 'units') : undefined,
    // Required for secondary — default 'product' so legacy rows opened and
    // saved without touching the control stay valid.
    packagingKind: kind === 'secondary' ? (e.packagingKind ?? 'product') : undefined,
    dependencies: kind === 'secondary' ? (e.dependencies ?? []) : undefined,
  });

  const onSave = async () => {
    if (!editing || !editing.name?.trim() || saving) return;
    setEditError(null);
    const payload = buildEditingPayload(editing);
    // A stock change goes through the same path as the inline list edit
    // (setManualStock → source 'manual' + date), and only when it changed, so
    // saving other fields never overwrites import-sourced stock.
    const original = editing.id ? items.find((c) => c.id === editing.id) : undefined;
    const stockChanged =
      editing.stockQty !== undefined && editing.stockQty !== original?.stockQty;
    setSaving(true);
    try {
      if (editing.id) {
        await window.electronAPI.updateComponent(editing.id, payload);
        if (stockChanged) {
          await window.electronAPI.setManualStock('component', editing.id, editing.stockQty ?? 0);
        }
      } else {
        const created = await window.electronAPI.createComponent(payload);
        if (stockChanged) {
          await window.electronAPI.setManualStock('component', created.id, editing.stockQty ?? 0);
        }
      }
      closeEditor();
      await reload();
    } catch (err) {
      setEditError(errorMessage(err));
    } finally {
      setSaving(false);
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
      // The full catalog names dependency targets outside this view.
      const all = await window.electronAPI.listComponents();
      const { content, filename } = exportComponentsCsv(items, suppliers, all);
      await saveFile(filename, content, 'csv');
    } catch (err) {
      setError(errorMessage(err));
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
      // Match against the whole catalog, not just this view's kind: a row may
      // name a component that lives in the other view (and must update it, not
      // duplicate it), and dependencies can point across.
      let all: PackagingComponent[];
      try {
        all = await window.electronAPI.listComponents();
      } catch (err) {
        setError(`${t.loadFailed}: ${errorMessage(err)}`);
        return;
      }
      try {
        const stats = await importComponentsCsv(r.content, all, suppliers);
        setInfo(formatStats(stats));
        await reload();
      } catch (err) {
        if (err instanceof ImportSaveError) {
          setError(`${t.importSaveFailed}: ${err.message}`);
          // Part of the file may already be saved — show what landed.
          await reload().catch(() => undefined);
        } else {
          setError(`${t.importInvalidFile}: ${errorMessage(err)}`);
        }
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
        section: kind,
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
      const res = await window.electronAPI.analyzeMagazynStock(kind);
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
    setError(null);
    try {
      const result = await window.electronAPI.deleteComponent(c.id);
      if (!result.ok) {
        setBlockedBy(result.blockedBy ?? []);
      } else {
        await reload();
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const onDuplicate = async (c: PackagingComponent) => {
    if (duplicatingId) return;
    setDuplicatingId(c.id);
    setError(null);
    try {
      await window.electronAPI.duplicateComponent(c.id);
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDuplicatingId(null);
    }
  };

  const onDeleteAll = async () => {
    setConfirmDeleteAll(false);
    setError(null);
    setInfo(null);
    setBusy(true);
    setLoaderMessage(t.deleteAllInProgress);
    const total = items.length;
    try {
      // One call; components still used by a product or another component
      // are skipped and reported.
      const res = await window.electronAPI.deleteCatalogItems(
        'component',
        items.map((c) => c.id),
      );
      const deleted = res.deleted;
      const blocked = res.blocked.length;
      const blockers = res.blocked.flatMap((b) => b.blockedBy);
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
    } catch (err) {
      setError(errorMessage(err));
      await reload().catch(() => undefined);
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
          const chip = (
            <span key={id} className={`supplier-chip ${isPreferred ? 'preferred' : ''}`}>
              {isPreferred && (
                <span className="supplier-chip-star">
                  <IconStar size={11} />
                </span>
              )}
              {supplierName(id)}
            </span>
          );
          return isPreferred ? (
            <HoverTooltip key={id} className="hover-tooltip-compact" trigger={chip}>
              {t.preferredSupplier}
            </HoverTooltip>
          ) : (
            chip
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
        <div style={{ marginLeft: 'auto' }}>
          <IconButton
            className="btn-sm"
            icon={<IconSettings size={14} />}
            label={t.settings}
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </div>

      <div className="card card-fill">
        <div className="toolbar">
          <div className="toolbar-actions">
            <ExportImportButtons format="csv" onExport={onExport} onImport={onImport} busy={busy} />
            <HoverTooltip
              triggerClassName="icon-button-trigger"
              trigger={
                <button className="btn btn-import" onClick={onClickImportXlsx} disabled={busy}>
                  <IconImport size={13} /> {t.componentsImportXlsx}
                </button>
              }
            >
              {t.componentsImportXlsxHint}
            </HoverTooltip>
            <HoverTooltip
              triggerClassName="icon-button-trigger"
              trigger={
                <button className="btn btn-import" onClick={onClickImportMagazyn} disabled={busy}>
                  <IconImport size={13} /> {t.magazynStockImport}
                </button>
              }
            >
              {t.magazynStockImportHint.replace('{tab}', magazynSheetName)}
            </HoverTooltip>
            <ColumnPicker
              columns={orderedColumns}
              isVisible={isVisible}
              toggle={toggle}
              reorder={reorder}
              reset={resetColumns}
              widths={widths}
              resetWidth={resetWidth}
            />
            <button
              className="btn danger"
              onClick={() => setConfirmDeleteAll(true)}
              disabled={busy || items.length === 0}
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
        {error && (
          <div className="error-text" style={{ marginBottom: 8 }}>
            {error}
          </div>
        )}
        {info && (
          <div className="hint" style={{ marginBottom: 8 }}>
            {info}
          </div>
        )}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {orderedVisibleIds.map((id) => decorateHeader(headerFor(id), id, widths[id]))}
                <th className="col-filler" aria-hidden />
                <th className="actions actions-sticky">{t.actionsHeader}</th>
              </tr>
            </thead>
            <tbody
              key={showSkeleton ? 'loading' : 'ready'}
              className={showSkeleton ? undefined : 'rows-enter'}
            >
              {showSkeleton ? (
                <SkeletonRows cells={orderedVisibleIds.length} filler actions />
              ) : (
                sorted.length === 0 && (
                  <tr>
                    <td
                      colSpan={orderedVisibleIds.length + 2}
                      className={loadError ? 'error-text' : 'hint'}
                    >
                      {loadError ?? (query ? '—' : t.noData)}
                    </td>
                  </tr>
                )
              )}
              {!showSkeleton && sorted.map((c) => (
                <tr key={c.id}>
                  {orderedVisibleIds.map((id) => cellFor(id, c))}
                  <td className="col-filler" />
                  <td className="actions actions-sticky">
                    <div className="btn-row">
                      <IconButton
                        className="btn-sm soft-danger"
                        icon={<IconTrash size={14} />}
                        label={t.delete}
                        onClick={() => setConfirmDelete(c)}
                      />
                      <IconButton
                        className="btn-sm soft-edit"
                        icon={<IconEdit size={14} />}
                        label={t.edit}
                        onClick={() => {
                          setEditingReadOnly(false);
                          setModalTab('basics');
                          setEditError(null);
                          setEditing(c);
                        }}
                      />
                      <IconButton
                        className="btn-sm soft-success"
                        icon={<IconDuplicate size={14} />}
                        label={t.duplicate}
                        disabled={duplicatingId !== null}
                        onClick={() => void onDuplicate(c)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={closeEditor}>
          <div
            className={`modal ${kind === 'secondary' ? 'modal-lg modal-tabbed' : 'modal-md'}${
              editingReadOnly ? ' modal-readonly' : ''
            }`}
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
              {(kind !== 'secondary' || modalTab === 'basics') && (
                <>
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
                        <label>{t.packagingKind}</label>
                        <SegmentedControl
                          ariaLabel={t.packagingKind}
                          value={editing.packagingKind ?? 'product'}
                          onChange={(v) =>
                            setEditing({ ...editing, packagingKind: v as PackagingKind })
                          }
                          disabled={editingReadOnly}
                          options={[
                            { value: 'product', label: t.packagingKindProduct },
                            { value: 'mass', label: t.packagingKindMass },
                          ]}
                        />
                      </div>
                      <div className="form-row">
                        <label>{t.packingCapacity}</label>
                        <NumberInput
                          className="input"
                          value={editing.capacity}
                          onChange={(v) => setEditing({ ...editing, capacity: v })}
                          disabled={editingReadOnly}
                        />
                      </div>
                      {lacksCapacity(editing) && (
                        <div className="warn-text" style={{ marginTop: -4, marginBottom: 8, fontSize: 12 }}>
                          {t.componentNoCapacityWarning}
                        </div>
                      )}
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
                      <label>{t.componentTypeLabel}</label>
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
                  {/* Stock is editable inline on the list, so it is here too. */}
                  <div className="form-row">
                    <label>
                      {t.stock} ({t.unitUnits})
                    </label>
                    <NumberInput
                      className="input"
                      value={editing.stockQty}
                      onChange={(v) => setEditing({ ...editing, stockQty: v })}
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
                  <div className="form-row" style={{ alignItems: 'flex-start' }}>
                    <label>{t.priceHistory}</label>
                    <div style={{ flex: 1 }}>
                      <PriceHistoryList
                        history={editing.priceHistory}
                        fallbackCurrency={editing.currency}
                      />
                    </div>
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
                </>
              )}
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
              {editError && <div className="error-text">{editError}</div>}
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
                  <button
                    className="btn primary-filled"
                    onClick={() => void onSave()}
                    disabled={saving || !editing.name?.trim()}
                  >
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

      {blockedBy && <BlockedByDialog blockedBy={blockedBy} onClose={() => setBlockedBy(null)} />}

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
    onChange([...deps, { componentId: availableOptions[0].value, consumption: 1 }]);
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
                      <IconButton
                        className="btn-sm"
                        icon={<IconEye size={13} />}
                        label={t.preview}
                        onClick={() => onOpenComponent(depComp)}
                      />
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
                    <IconButton
                      className="btn-sm soft-danger"
                      icon={<IconClose size={12} />}
                      label={t.delete}
                      onClick={() => remove(idx)}
                    />
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
              {unmatched.length > 0 && (
                <div className="warn-text" style={{ marginBottom: 12, fontSize: 12 }}>
                  {t.magazynStockUnmatchedNotice.replace('{n}', String(unmatched.length))}
                </div>
              )}
              <div className="apply-all-row">
                <span className="apply-all-label">{t.applyToAllLabel}</span>
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
                            <SegmentedControl
                              size="sm"
                              ariaLabel={m.name}
                              value={action}
                              onChange={(v) => setOne(m.itemId, v)}
                              options={[
                                { value: 'keep', label: t.magazynStockKeep, tone: 'neutral' },
                                { value: 'take', label: t.magazynStockTake, tone: 'success' },
                              ]}
                            />
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
              <div className="apply-all-row">
                <span className="apply-all-label">{t.applyToAllLabel}</span>
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
                            <SegmentedControl
                              size="sm"
                              ariaLabel={u.name}
                              value={create ? 'create' : 'ignore'}
                              onChange={(v) => {
                                if ((v === 'create') !== create) toggleCreate(u.name);
                              }}
                              options={[
                                { value: 'ignore', label: t.magazynStockIgnore, tone: 'neutral' },
                                { value: 'create', label: t.magazynStockCreate, tone: 'success' },
                              ]}
                            />
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
