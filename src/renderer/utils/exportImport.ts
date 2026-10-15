import type {
  Supplier,
  RawMaterial,
  PackagingComponent,
  PackingScheme,
  Product,
  ProductionPlan,
  Lang,
  Unit,
  ComponentType,
  ComponentDependency,
  PackagingKind,
  PackingCapacityUnit,
} from '../../shared/types';
import { isSecondaryComponent } from '../../shared/types';
import { localDateIso } from '../../shared/dates';
import { toCsv, parseCsv, parseBool, parseNumber } from './csv';

export interface ImportStats {
  created: number;
  updated: number;
  skipped: number;
  unresolved: number; // references to suppliers/products/etc. that couldn't be resolved
}

// Thrown when the file parsed fine but writing it to the database failed
// (network, permissions, validation in the main process). Views tell it apart
// from a malformed file and reload, since part of the import may have landed.
export class ImportSaveError extends Error {
  constructor(
    message: string,
    readonly stats: ImportStats,
  ) {
    super(message);
    this.name = 'ImportSaveError';
  }
}

const runSave = async <R>(stats: ImportStats, save: () => Promise<R>): Promise<R> => {
  try {
    return await save();
  } catch (err) {
    throw new ImportSaveError(err instanceof Error ? err.message : String(err), stats);
  }
};

// One bulk-save entry per catalog name: a row naming an existing item patches
// it, a row naming a new item creates it, and a name repeated in the file
// collapses into one entry where the later row wins — the same outcome (and
// the same stats) as the old row-by-row import, in a single write.
class UpsertBatch<P> {
  private readonly byName = new Map<string, { id?: string; patch: P }>();

  constructor(
    private readonly existing: { id: string; name: string }[],
    private readonly stats: ImportStats,
  ) {}

  add(name: string, patch: P): void {
    const key = name.trim().toLowerCase();
    const prev = this.byName.get(key);
    if (prev) {
      prev.patch = patch;
      this.stats.updated++;
      return;
    }
    const match = findByName(this.existing, name);
    this.byName.set(key, { id: match?.id, patch });
    if (match) this.stats.updated++;
    else this.stats.created++;
  }

  get items(): { id?: string; patch: P }[] {
    return Array.from(this.byName.values());
  }
}

const today = (): string => localDateIso();

const findByName = <T extends { name: string }>(
  list: T[],
  name: string,
): T | undefined => {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return list.find((x) => x.name.trim().toLowerCase() === needle);
};

// ---------- Suppliers ----------

const SUPPLIER_COLUMNS = [
  'name',
  'type',
  'email',
  'phone',
  'contactPerson',
  'paymentTerms',
  'preferredEmailLanguage',
  'notes',
];

export function exportSuppliersCsv(items: Supplier[]): {
  content: string;
  filename: string;
} {
  const rows = items.map((s) => ({
    name: s.name,
    type: s.type ?? '',
    email: s.email,
    phone: s.phone ?? '',
    contactPerson: s.contactPerson ?? '',
    paymentTerms: s.paymentTerms ?? '',
    preferredEmailLanguage: s.preferredEmailLanguage ?? '',
    notes: s.notes ?? '',
  }));
  return {
    content: toCsv(rows, SUPPLIER_COLUMNS),
    filename: `cutis-suppliers-${today()}.csv`,
  };
}

export async function importSuppliersCsv(
  csv: string,
  existing: Supplier[],
): Promise<ImportStats> {
  const stats: ImportStats = { created: 0, updated: 0, skipped: 0, unresolved: 0 };
  const rows = parseCsv(csv);
  const batch = new UpsertBatch<Partial<Omit<Supplier, 'id' | 'createdAt'>>>(existing, stats);
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    if (!name) {
      stats.skipped++;
      continue;
    }
    const lang = (r.preferredEmailLanguage ?? '').trim().toLowerCase();
    const rawType = (r.type ?? '').trim().toLowerCase();
    const payload = {
      name,
      email: (r.email ?? '').trim(),
      type:
        rawType === 'raw' || rawType === 'component'
          ? (rawType as 'raw' | 'component')
          : undefined,
      phone: r.phone?.trim() || undefined,
      contactPerson: r.contactPerson?.trim() || undefined,
      paymentTerms: r.paymentTerms?.trim() || undefined,
      notes: r.notes?.trim() || undefined,
      preferredEmailLanguage:
        lang === 'pl' || lang === 'en' ? (lang as Lang) : undefined,
    };
    batch.add(name, payload);
  }
  if (batch.items.length > 0) {
    await runSave(stats, () => window.electronAPI.saveSuppliers(batch.items));
  }
  return stats;
}

// ---------- Raw materials ----------

const RAW_COLUMNS = [
  'name',
  'mpFirmaSymbol',
  'unit',
  'suppliers',
  'preferredSupplier',
  'factorySupplied',
  'moq',
  'leadTimeDays',
  'shelfLifeMonths',
  'lastPurchasePriceNet',
  'currency',
  'notes',
];

export function exportRawMaterialsCsv(
  items: RawMaterial[],
  suppliers: Supplier[],
): { content: string; filename: string } {
  const supplierName = (id: string) =>
    suppliers.find((s) => s.id === id)?.name ?? '';
  const rows = items.map((rm) => ({
    name: rm.name,
    mpFirmaSymbol: rm.mpFirmaSymbol ?? '',
    unit: rm.unit,
    suppliers: rm.supplierIds
      .map(supplierName)
      .filter(Boolean)
      .join('|'),
    preferredSupplier: rm.preferredSupplierId ? supplierName(rm.preferredSupplierId) : '',
    factorySupplied: rm.factorySupplied,
    moq: rm.moq ?? '',
    leadTimeDays: rm.leadTimeDays ?? '',
    shelfLifeMonths: rm.shelfLifeMonths ?? '',
    lastPurchasePriceNet: rm.lastPurchasePriceNet ?? '',
    currency: rm.currency ?? '',
    notes: rm.notes ?? '',
  }));
  return {
    content: toCsv(rows, RAW_COLUMNS),
    filename: `cutis-raw-materials-${today()}.csv`,
  };
}

export async function importRawMaterialsCsv(
  csv: string,
  existing: RawMaterial[],
  suppliers: Supplier[],
): Promise<ImportStats> {
  const stats: ImportStats = { created: 0, updated: 0, skipped: 0, unresolved: 0 };
  const rows = parseCsv(csv);
  const batch = new UpsertBatch<Partial<Omit<RawMaterial, 'id' | 'createdAt'>>>(existing, stats);
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    if (!name) {
      stats.skipped++;
      continue;
    }
    const supplierIds: string[] = [];
    const supplierNames = (r.suppliers ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sn of supplierNames) {
      const s = findByName(suppliers, sn);
      if (s) supplierIds.push(s.id);
      else stats.unresolved++;
    }
    let preferredSupplierId: string | undefined;
    const prefName = (r.preferredSupplier ?? '').trim();
    if (prefName) {
      const s = findByName(suppliers, prefName);
      if (s) {
        preferredSupplierId = s.id;
        if (!supplierIds.includes(s.id)) supplierIds.push(s.id);
      } else {
        stats.unresolved++;
      }
    }
    const unit = (r.unit ?? 'kg').trim().toLowerCase();
    const validUnit: Unit =
      unit === 'g' || unit === 'kg' || unit === 'ml' || unit === 'l'
        ? (unit as Unit)
        : 'kg';
    const payload = {
      name,
      mpFirmaSymbol: r.mpFirmaSymbol?.trim() || undefined,
      unit: validUnit,
      supplierIds,
      preferredSupplierId,
      factorySupplied: parseBool(r.factorySupplied),
      moq: parseNumber(r.moq),
      leadTimeDays: parseNumber(r.leadTimeDays),
      shelfLifeMonths: parseNumber(r.shelfLifeMonths),
      lastPurchasePriceNet: parseNumber(r.lastPurchasePriceNet),
      currency: r.currency?.trim() || undefined,
      notes: r.notes?.trim() || undefined,
    };
    batch.add(name, payload);
  }
  if (batch.items.length > 0) {
    await runSave(stats, () =>
      window.electronAPI.saveRawMaterials(batch.items, { priceSource: 'import' }),
    );
  }
  return stats;
}

// ---------- Components ----------

// Every ComponentType, primary and secondary. A Record over the union makes
// the compiler flag this list whenever a type is added, so an exported file
// never round-trips a valid type into 'other'.
const COMPONENT_TYPE_SET: Record<ComponentType, true> = {
  tube: true,
  bottle: true,
  jar: true,
  label: true,
  cap: true,
  pump: true,
  pipette: true,
  box: true,
  leaflet: true,
  outer_carton: true,
  tape: true,
  barrel: true,
  bag: true,
  confection: true,
  other: true,
};
const COMPONENT_TYPES = Object.keys(COMPONENT_TYPE_SET) as ComponentType[];

const CAPACITY_UNITS: PackingCapacityUnit[] = ['units', 'kg', 'l', 'm'];

const COMPONENT_COLUMNS = [
  'name',
  'type',
  'mpFirmaSymbol',
  'suppliers',
  'preferredSupplier',
  'moq',
  'leadTimeDays',
  'lastPurchasePriceNet',
  'currency',
  'notes',
  // Secondary (shipping) packaging only — empty for primary components.
  'packagingKind',
  'capacity',
  'capacityUnit',
  // "Name:consumption" pairs joined by '|', by component name.
  'dependencies',
];

export function exportComponentsCsv(
  items: PackagingComponent[],
  suppliers: Supplier[],
  // Full catalog, to name dependency targets that live outside `items`.
  allComponents: PackagingComponent[] = items,
): { content: string; filename: string } {
  const supplierName = (id: string) =>
    suppliers.find((s) => s.id === id)?.name ?? '';
  const componentName = (id: string) =>
    allComponents.find((c) => c.id === id)?.name ?? '';
  const rows = items.map((c) => {
    const secondary = isSecondaryComponent(c.type);
    return {
      name: c.name,
      type: c.type,
      mpFirmaSymbol: c.mpFirmaSymbol ?? '',
      suppliers: c.supplierIds.map(supplierName).filter(Boolean).join('|'),
      preferredSupplier: c.preferredSupplierId ? supplierName(c.preferredSupplierId) : '',
      moq: c.moq ?? '',
      leadTimeDays: c.leadTimeDays ?? '',
      lastPurchasePriceNet: c.lastPurchasePriceNet ?? '',
      currency: c.currency ?? '',
      notes: c.notes ?? '',
      packagingKind: secondary ? (c.packagingKind ?? 'product') : '',
      capacity: secondary ? (c.capacity ?? '') : '',
      capacityUnit: secondary ? (c.capacityUnit ?? 'units') : '',
      dependencies: secondary
        ? (c.dependencies ?? [])
            .map((d) => {
              const n = componentName(d.componentId);
              return n ? `${n}:${d.consumption}` : '';
            })
            .filter(Boolean)
            .join('|')
        : '',
    };
  });
  return {
    content: toCsv(rows, COMPONENT_COLUMNS),
    filename: `cutis-components-${today()}.csv`,
  };
}

// `existing` must be the FULL component catalog (both primary and secondary)
// — matching against one view's subset would duplicate items that live in the
// other view, and dependency names could not resolve.
export async function importComponentsCsv(
  csv: string,
  existing: PackagingComponent[],
  suppliers: Supplier[],
): Promise<ImportStats> {
  const stats: ImportStats = { created: 0, updated: 0, skipped: 0, unresolved: 0 };
  const rows = parseCsv(csv);
  type Patch = Partial<Omit<PackagingComponent, 'id' | 'createdAt'>>;
  const batch = new UpsertBatch<Patch>(existing, stats);
  // Dependencies naming a component that this same file creates can only be
  // resolved once it exists — keyed by the (lower-cased) owner name.
  const pendingDeps = new Map<string, { name: string; consumption: number }[]>();
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    if (!name) {
      stats.skipped++;
      continue;
    }
    const supplierIds: string[] = [];
    for (const sn of (r.suppliers ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const s = findByName(suppliers, sn);
      if (s) supplierIds.push(s.id);
      else stats.unresolved++;
    }
    let preferredSupplierId: string | undefined;
    const prefName = (r.preferredSupplier ?? '').trim();
    if (prefName) {
      const s = findByName(suppliers, prefName);
      if (s) {
        preferredSupplierId = s.id;
        if (!supplierIds.includes(s.id)) supplierIds.push(s.id);
      } else {
        stats.unresolved++;
      }
    }
    const typeRaw = (r.type ?? 'other').trim().toLowerCase();
    const type: ComponentType = (COMPONENT_TYPES as string[]).includes(typeRaw)
      ? (typeRaw as ComponentType)
      : 'other';
    const payload: Patch = {
      name,
      type,
      mpFirmaSymbol: r.mpFirmaSymbol?.trim() || undefined,
      supplierIds,
      preferredSupplierId,
      moq: parseNumber(r.moq),
      leadTimeDays: parseNumber(r.leadTimeDays),
      lastPurchasePriceNet: parseNumber(r.lastPurchasePriceNet),
      currency: r.currency?.trim() || undefined,
      notes: r.notes?.trim() || undefined,
    };
    // Secondary-only fields are written only when the file has their columns,
    // so an older export (without them) never wipes capacity/dependencies.
    // Like the editor, a primary component gets them cleared.
    const secondary = isSecondaryComponent(type);
    if ('packagingKind' in r) {
      const kind = r.packagingKind.trim().toLowerCase();
      const packagingKind: PackagingKind = kind === 'mass' ? 'mass' : 'product';
      payload.packagingKind = secondary ? packagingKind : undefined;
    }
    if ('capacity' in r) {
      payload.capacity = secondary ? parseNumber(r.capacity) : undefined;
    }
    if ('capacityUnit' in r) {
      const unit = r.capacityUnit.trim().toLowerCase() as PackingCapacityUnit;
      payload.capacityUnit = secondary
        ? CAPACITY_UNITS.includes(unit)
          ? unit
          : 'units'
        : undefined;
    }
    if ('dependencies' in r) {
      const deps: ComponentDependency[] = [];
      const pending: { name: string; consumption: number }[] = [];
      if (secondary) {
        for (const part of r.dependencies.split('|').map((s) => s.trim()).filter(Boolean)) {
          const sep = part.lastIndexOf(':');
          const depName = (sep >= 0 ? part.slice(0, sep) : part).trim();
          const consumption = sep >= 0 ? (parseNumber(part.slice(sep + 1).trim()) ?? 1) : 1;
          const target = findByName(existing, depName);
          if (target) deps.push({ componentId: target.id, consumption });
          else pending.push({ name: depName, consumption });
        }
      }
      payload.dependencies = secondary ? deps : undefined;
      if (pending.length > 0) pendingDeps.set(name.toLowerCase(), pending);
      else pendingDeps.delete(name.toLowerCase());
    }
    batch.add(name, payload);
  }
  if (batch.items.length === 0) return stats;
  const saved = await runSave(stats, () =>
    window.electronAPI.saveComponents(batch.items, { priceSource: 'import' }),
  );
  if (pendingDeps.size > 0) {
    // Second pass: point the remaining dependencies at components the first
    // write just created. Names still unknown are counted as unresolved.
    const catalog = [...existing, ...saved];
    const fixes: { id: string; patch: Patch }[] = [];
    for (const [ownerKey, pending] of pendingDeps) {
      const owner = saved.find((c) => c.name.trim().toLowerCase() === ownerKey);
      if (!owner) continue;
      const deps = [...(owner.dependencies ?? [])];
      let changed = false;
      for (const p of pending) {
        const target = findByName(catalog, p.name);
        if (target && target.id !== owner.id) {
          deps.push({ componentId: target.id, consumption: p.consumption });
          changed = true;
        } else {
          stats.unresolved++;
        }
      }
      if (changed) fixes.push({ id: owner.id, patch: { dependencies: deps } });
    }
    if (fixes.length > 0) {
      await runSave(stats, () => window.electronAPI.saveComponents(fixes));
    }
  }
  return stats;
}

// ---------- Products (JSON, recipes nested) ----------

interface ProductExportRow {
  name: string;
  sku?: string;
  capacityMl: number;
  densityGPerMl: number;
  conversionLaborCost?: number;
  ingredients: { rawMaterialName: string; percentage: number }[];
  packaging: { componentName: string; qtyPerUnit: number }[];
  packingScheme?: {
    tiers: {
      componentName: string;
      consumption: number;
      consumptionOverride?: boolean;
      note?: string;
    }[];
  };
  notes?: string;
  archived: boolean;
}

export function exportProductsJson(
  items: Product[],
  rawMaterials: RawMaterial[],
  components: PackagingComponent[],
): { content: string; filename: string } {
  const rmName = (id: string) => rawMaterials.find((r) => r.id === id)?.name ?? '';
  const compName = (id: string) => components.find((c) => c.id === id)?.name ?? '';
  const rows: ProductExportRow[] = items.map((p) => ({
    name: p.name,
    sku: p.sku,
    capacityMl: p.capacityMl,
    densityGPerMl: p.densityGPerMl,
    conversionLaborCost: p.conversionLaborCost,
    ingredients: p.ingredients
      .map((i) => ({
        rawMaterialName: rmName(i.rawMaterialId),
        percentage: i.percentage,
      }))
      .filter((i) => i.rawMaterialName),
    packaging: p.packaging
      .map((pk) => ({
        componentName: compName(pk.componentId),
        qtyPerUnit: pk.qtyPerUnit,
      }))
      .filter((pk) => pk.componentName),
    packingScheme: p.packingScheme
      ? {
          tiers: p.packingScheme.tiers
            .map((t) => ({
              componentName: compName(t.componentId),
              consumption: t.consumption,
              consumptionOverride: t.consumptionOverride,
              note: t.note,
            }))
            .filter((t) => t.componentName),
        }
      : undefined,
    notes: p.notes,
    archived: p.archived,
  }));
  return {
    content: JSON.stringify(rows, null, 2),
    filename: `cutis-products-${today()}.json`,
  };
}

export async function importProductsJson(
  json: string,
  existing: Product[],
  rawMaterials: RawMaterial[],
  components: PackagingComponent[],
): Promise<ImportStats> {
  const stats: ImportStats = { created: 0, updated: 0, skipped: 0, unresolved: 0 };
  const data = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error('Expected JSON array');
  const batch = new UpsertBatch<Partial<Omit<Product, 'id' | 'createdAt'>>>(existing, stats);
  for (const r of data as ProductExportRow[]) {
    const name = (r?.name ?? '').trim();
    if (!name) {
      stats.skipped++;
      continue;
    }
    const ingredients: Product['ingredients'] = [];
    for (const i of r.ingredients ?? []) {
      const rm = findByName(rawMaterials, i.rawMaterialName ?? '');
      if (rm) ingredients.push({ rawMaterialId: rm.id, percentage: Number(i.percentage) || 0 });
      else stats.unresolved++;
    }
    const packaging: Product['packaging'] = [];
    for (const pk of r.packaging ?? []) {
      const c = findByName(components, pk.componentName ?? '');
      if (c) packaging.push({ componentId: c.id, qtyPerUnit: Number(pk.qtyPerUnit) || 0 });
      else stats.unresolved++;
    }
    let packingScheme: PackingScheme | undefined;
    if (r.packingScheme?.tiers && r.packingScheme.tiers.length > 0) {
      const tiers = [];
      for (const t of r.packingScheme.tiers) {
        const c = findByName(components, t.componentName ?? '');
        if (!c) {
          stats.unresolved++;
          continue;
        }
        tiers.push({
          componentId: c.id,
          consumption: Number(t.consumption) || 1,
          consumptionOverride: t.consumptionOverride,
          note: t.note,
        });
      }
      if (tiers.length > 0) packingScheme = { tiers };
    }
    const payload = {
      name,
      sku: r.sku?.trim() || undefined,
      capacityMl: Number(r.capacityMl) || 0,
      densityGPerMl: Number(r.densityGPerMl) || 1,
      conversionLaborCost:
        typeof r.conversionLaborCost === 'number' ? r.conversionLaborCost : undefined,
      ingredients,
      packaging,
      packingScheme,
      notes: r.notes?.trim() || undefined,
      archived: !!r.archived,
    };
    batch.add(name, payload);
  }
  if (batch.items.length > 0) {
    await runSave(stats, () => window.electronAPI.saveProducts(batch.items));
  }
  return stats;
}

// ---------- Production plans (JSON, items nested) ----------

interface PlanExportRow {
  name: string;
  status: ProductionPlan['status'];
  items: { productName: string; qtyUnits: number }[];
  bulkMass: { productName: string; massKg: number }[];
}

export function exportPlansJson(
  items: ProductionPlan[],
  products: Product[],
): { content: string; filename: string } {
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? '';
  const rows: PlanExportRow[] = items.map((p) => ({
    name: p.name,
    status: p.status,
    items: p.items
      .map((i) => ({ productName: productName(i.productId), qtyUnits: i.qtyUnits }))
      .filter((i) => i.productName),
    bulkMass: (p.bulkMass ?? [])
      .map((b) => ({ productName: productName(b.productId), massKg: b.massKg }))
      .filter((b) => b.productName),
  }));
  return {
    content: JSON.stringify(rows, null, 2),
    filename: `cutis-production-plans-${today()}.json`,
  };
}

export async function importPlansJson(
  json: string,
  existing: ProductionPlan[],
  products: Product[],
): Promise<ImportStats> {
  const stats: ImportStats = { created: 0, updated: 0, skipped: 0, unresolved: 0 };
  const data = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error('Expected JSON array');
  for (const r of data as PlanExportRow[]) {
    const name = (r?.name ?? '').trim();
    if (!name) {
      stats.skipped++;
      continue;
    }
    const items: ProductionPlan['items'] = [];
    for (const i of r.items ?? []) {
      const p = findByName(products, i.productName ?? '');
      if (p) items.push({ productId: p.id, qtyUnits: Number(i.qtyUnits) || 0 });
      else stats.unresolved++;
    }
    const bulkMass: ProductionPlan['bulkMass'] = [];
    for (const b of r.bulkMass ?? []) {
      const p = findByName(products, b.productName ?? '');
      if (p) bulkMass.push({ productId: p.id, massKg: Number(b.massKg) || 0 });
      else stats.unresolved++;
    }
    const status: ProductionPlan['status'] =
      r.status === 'computed' || r.status === 'archived' ? r.status : 'draft';
    const payload = { name, items, bulkMass, status };
    const match = findByName(existing, name);
    // No bulk plan save exists in the API yet, so plans still go one by one;
    // a failure is still reported as a save error with the partial stats.
    if (match) {
      await runSave(stats, () => window.electronAPI.updatePlan(match.id, payload));
      stats.updated++;
    } else {
      const created = await runSave(stats, () => window.electronAPI.createPlan(payload));
      existing.push(created);
      stats.created++;
    }
  }
  return stats;
}

// ---------- File I/O wrappers ----------

export async function saveFile(
  defaultName: string,
  content: string,
  ext: 'csv' | 'json',
): Promise<{ ok: boolean; path?: string }> {
  const filters =
    ext === 'csv'
      ? [{ name: 'CSV', extensions: ['csv'] }]
      : [{ name: 'JSON', extensions: ['json'] }];
  return window.electronAPI.saveTextFile({ defaultName, content, filters });
}

export async function openFile(
  ext: 'csv' | 'json',
): Promise<{ ok: boolean; content?: string; path?: string }> {
  const filters =
    ext === 'csv'
      ? [{ name: 'CSV', extensions: ['csv'] }]
      : [{ name: 'JSON', extensions: ['json'] }];
  return window.electronAPI.openTextFile({ filters });
}

export function formatStats(s: ImportStats): string {
  const parts = [
    `+${s.created}`,
    `~${s.updated}`,
  ];
  if (s.skipped) parts.push(`skip ${s.skipped}`);
  if (s.unresolved) parts.push(`?${s.unresolved}`);
  return parts.join(' · ');
}
