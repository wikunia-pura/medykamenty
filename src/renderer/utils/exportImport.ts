import type {
  Supplier,
  RawMaterial,
  PackagingComponent,
  Product,
  ProductionPlan,
  Lang,
  Unit,
  ComponentType,
} from '../../shared/types';
import { toCsv, parseCsv, parseBool, parseNumber } from './csv';

export interface ImportStats {
  created: number;
  updated: number;
  skipped: number;
  unresolved: number; // references to suppliers/products/etc. that couldn't be resolved
}

const today = (): string => new Date().toISOString().slice(0, 10);

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
  for (const r of rows) {
    const name = (r.name ?? '').trim();
    if (!name) {
      stats.skipped++;
      continue;
    }
    const lang = (r.preferredEmailLanguage ?? '').trim().toLowerCase();
    const payload = {
      name,
      email: (r.email ?? '').trim(),
      phone: r.phone?.trim() || undefined,
      contactPerson: r.contactPerson?.trim() || undefined,
      paymentTerms: r.paymentTerms?.trim() || undefined,
      notes: r.notes?.trim() || undefined,
      preferredEmailLanguage:
        lang === 'pl' || lang === 'en' ? (lang as Lang) : undefined,
    };
    const match = findByName(existing, name);
    if (match) {
      await window.electronAPI.updateSupplier(match.id, payload);
      stats.updated++;
    } else {
      const created = await window.electronAPI.createSupplier(payload);
      existing.push(created);
      stats.created++;
    }
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
    const match = findByName(existing, name);
    if (match) {
      await window.electronAPI.updateRawMaterial(match.id, payload);
      stats.updated++;
    } else {
      const created = await window.electronAPI.createRawMaterial(payload);
      existing.push(created);
      stats.created++;
    }
  }
  return stats;
}

// ---------- Components ----------

const COMPONENT_TYPES: ComponentType[] = [
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
];

export function exportComponentsCsv(
  items: PackagingComponent[],
  suppliers: Supplier[],
): { content: string; filename: string } {
  const supplierName = (id: string) =>
    suppliers.find((s) => s.id === id)?.name ?? '';
  const rows = items.map((c) => ({
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
  }));
  return {
    content: toCsv(rows, COMPONENT_COLUMNS),
    filename: `cutis-components-${today()}.csv`,
  };
}

export async function importComponentsCsv(
  csv: string,
  existing: PackagingComponent[],
  suppliers: Supplier[],
): Promise<ImportStats> {
  const stats: ImportStats = { created: 0, updated: 0, skipped: 0, unresolved: 0 };
  const rows = parseCsv(csv);
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
    const payload = {
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
    const match = findByName(existing, name);
    if (match) {
      await window.electronAPI.updateComponent(match.id, payload);
      stats.updated++;
    } else {
      const created = await window.electronAPI.createComponent(payload);
      existing.push(created);
      stats.created++;
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
    const payload = {
      name,
      sku: r.sku?.trim() || undefined,
      capacityMl: Number(r.capacityMl) || 0,
      densityGPerMl: Number(r.densityGPerMl) || 1,
      conversionLaborCost:
        typeof r.conversionLaborCost === 'number' ? r.conversionLaborCost : undefined,
      ingredients,
      packaging,
      notes: r.notes?.trim() || undefined,
      archived: !!r.archived,
    };
    const match = findByName(existing, name);
    if (match) {
      await window.electronAPI.updateProduct(match.id, payload);
      stats.updated++;
    } else {
      const created = await window.electronAPI.createProduct(payload);
      existing.push(created);
      stats.created++;
    }
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
    if (match) {
      await window.electronAPI.updatePlan(match.id, payload);
      stats.updated++;
    } else {
      const created = await window.electronAPI.createPlan(payload);
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
