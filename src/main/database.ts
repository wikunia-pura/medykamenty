import Store from 'electron-store';
import type {
  StoreSchema,
  Supplier,
  RawMaterial,
  PackagingComponent,
  Product,
  StockSnapshot,
  StockRow,
  ProductionPlan,
  AppSettings,
  StockKind,
  ShortageReport,
  ShortageReportEntry,
} from '../shared/types';
import {
  STORE_SCHEMA_VERSION,
  DEFAULT_WASTE_FACTOR,
  DEFAULT_CURRENCY,
  DEFAULT_LANGUAGE,
  STOCK_SNAPSHOT_RETENTION,
  SHORTAGE_REPORT_RETENTION,
} from '../shared/constants';
import { newId, nowIso } from './utils/id';

const DEFAULT_SETTINGS: AppSettings = {
  language: DEFAULT_LANGUAGE,
  darkMode: false,
  wasteFactor: DEFAULT_WASTE_FACTOR,
  defaultCurrency: DEFAULT_CURRENCY,
  defaultEmailLanguage: DEFAULT_LANGUAGE,
  llm: {
    useByDefault: false,
  },
};

const DEFAULTS: StoreSchema = {
  schemaVersion: STORE_SCHEMA_VERSION,
  suppliers: [],
  rawMaterials: [],
  components: [],
  products: [],
  stockSnapshots: [],
  productionPlans: [],
  shortageReports: [],
  settings: DEFAULT_SETTINGS,
};

export default class Database {
  private store: Store<StoreSchema>;

  constructor() {
    this.store = new Store<StoreSchema>({ defaults: DEFAULTS });
    this.runMigrations();
  }

  private runMigrations(): void {
    const v = this.store.get('schemaVersion', 0);
    if (v < STORE_SCHEMA_VERSION) {
      const settings = { ...DEFAULT_SETTINGS, ...this.store.get('settings', DEFAULT_SETTINGS) };
      this.store.set('settings', settings);
      this.store.set('schemaVersion', STORE_SCHEMA_VERSION);
    }
  }

  // ---- Suppliers ----
  listSuppliers(): Supplier[] {
    return [...this.store.get('suppliers', [])].sort((a, b) => a.name.localeCompare(b.name));
  }
  getSupplier(id: string): Supplier | undefined {
    return this.store.get('suppliers', []).find((s) => s.id === id);
  }
  createSupplier(input: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Supplier {
    const now = nowIso();
    const supplier: Supplier = { ...input, id: newId(), createdAt: now, updatedAt: now };
    this.store.set('suppliers', [...this.store.get('suppliers', []), supplier]);
    return supplier;
  }
  updateSupplier(id: string, patch: Partial<Omit<Supplier, 'id' | 'createdAt'>>): Supplier {
    const list = this.store.get('suppliers', []);
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) throw new Error(`Supplier ${id} not found`);
    const updated: Supplier = { ...list[idx], ...patch, id, updatedAt: nowIso() };
    list[idx] = updated;
    this.store.set('suppliers', list);
    return updated;
  }
  deleteSupplier(id: string): { ok: boolean; blockedBy?: string[] } {
    const blockedBy: string[] = [];
    for (const rm of this.store.get('rawMaterials', [])) {
      if (rm.supplierIds.includes(id)) blockedBy.push(`raw:${rm.name}`);
    }
    for (const c of this.store.get('components', [])) {
      if (c.supplierIds.includes(id)) blockedBy.push(`component:${c.name}`);
    }
    if (blockedBy.length > 0) return { ok: false, blockedBy };
    this.store.set(
      'suppliers',
      this.store.get('suppliers', []).filter((s) => s.id !== id),
    );
    return { ok: true };
  }

  // ---- Raw materials ----
  listRawMaterials(): RawMaterial[] {
    return [...this.store.get('rawMaterials', [])].sort((a, b) => a.name.localeCompare(b.name));
  }
  getRawMaterial(id: string): RawMaterial | undefined {
    return this.store.get('rawMaterials', []).find((r) => r.id === id);
  }
  createRawMaterial(input: Omit<RawMaterial, 'id' | 'createdAt' | 'updatedAt'>): RawMaterial {
    const now = nowIso();
    const rm: RawMaterial = { ...input, id: newId(), createdAt: now, updatedAt: now };
    this.store.set('rawMaterials', [...this.store.get('rawMaterials', []), rm]);
    return rm;
  }
  updateRawMaterial(
    id: string,
    patch: Partial<Omit<RawMaterial, 'id' | 'createdAt'>>,
  ): RawMaterial {
    const list = this.store.get('rawMaterials', []);
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`RawMaterial ${id} not found`);
    const updated: RawMaterial = { ...list[idx], ...patch, id, updatedAt: nowIso() };
    list[idx] = updated;
    this.store.set('rawMaterials', list);
    return updated;
  }
  deleteRawMaterial(id: string): { ok: boolean; blockedBy?: string[] } {
    const blockedBy: string[] = [];
    for (const p of this.store.get('products', [])) {
      if (p.ingredients.some((i) => i.rawMaterialId === id)) blockedBy.push(`product:${p.name}`);
    }
    if (blockedBy.length > 0) return { ok: false, blockedBy };
    this.store.set(
      'rawMaterials',
      this.store.get('rawMaterials', []).filter((r) => r.id !== id),
    );
    return { ok: true };
  }
  // For stock import: refresh price by id without changing updatedAt of business fields hard
  setRawMaterialLastPrice(id: string, price: number, currency?: string): void {
    const list = this.store.get('rawMaterials', []);
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return;
    list[idx] = {
      ...list[idx],
      lastPurchasePriceNet: price,
      currency: currency ?? list[idx].currency,
      updatedAt: nowIso(),
    };
    this.store.set('rawMaterials', list);
  }

  // ---- Components ----
  listComponents(): PackagingComponent[] {
    return [...this.store.get('components', [])].sort((a, b) => a.name.localeCompare(b.name));
  }
  getComponent(id: string): PackagingComponent | undefined {
    return this.store.get('components', []).find((c) => c.id === id);
  }
  createComponent(
    input: Omit<PackagingComponent, 'id' | 'createdAt' | 'updatedAt'>,
  ): PackagingComponent {
    const now = nowIso();
    const c: PackagingComponent = { ...input, id: newId(), createdAt: now, updatedAt: now };
    this.store.set('components', [...this.store.get('components', []), c]);
    return c;
  }
  updateComponent(
    id: string,
    patch: Partial<Omit<PackagingComponent, 'id' | 'createdAt'>>,
  ): PackagingComponent {
    const list = this.store.get('components', []);
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Component ${id} not found`);
    const updated: PackagingComponent = { ...list[idx], ...patch, id, updatedAt: nowIso() };
    list[idx] = updated;
    this.store.set('components', list);
    return updated;
  }
  deleteComponent(id: string): { ok: boolean; blockedBy?: string[] } {
    const blockedBy: string[] = [];
    for (const p of this.store.get('products', [])) {
      if (p.packaging.some((pkg) => pkg.componentId === id)) blockedBy.push(`product:${p.name}`);
    }
    if (blockedBy.length > 0) return { ok: false, blockedBy };
    this.store.set(
      'components',
      this.store.get('components', []).filter((c) => c.id !== id),
    );
    return { ok: true };
  }
  setComponentLastPrice(id: string, price: number, currency?: string): void {
    const list = this.store.get('components', []);
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return;
    list[idx] = {
      ...list[idx],
      lastPurchasePriceNet: price,
      currency: currency ?? list[idx].currency,
      updatedAt: nowIso(),
    };
    this.store.set('components', list);
  }

  // ---- Products ----
  listProducts(): Product[] {
    return [...this.store.get('products', [])].sort((a, b) => a.name.localeCompare(b.name));
  }
  getProduct(id: string): Product | undefined {
    return this.store.get('products', []).find((p) => p.id === id);
  }
  createProduct(input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Product {
    const now = nowIso();
    const p: Product = { ...input, id: newId(), createdAt: now, updatedAt: now };
    this.store.set('products', [...this.store.get('products', []), p]);
    return p;
  }
  updateProduct(id: string, patch: Partial<Omit<Product, 'id' | 'createdAt'>>): Product {
    const list = this.store.get('products', []);
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Product ${id} not found`);
    const updated: Product = { ...list[idx], ...patch, id, updatedAt: nowIso() };
    list[idx] = updated;
    this.store.set('products', list);
    return updated;
  }
  deleteProduct(id: string): { ok: boolean } {
    this.store.set(
      'products',
      this.store.get('products', []).filter((p) => p.id !== id),
    );
    return { ok: true };
  }
  duplicateProduct(id: string): Product {
    const original = this.getProduct(id);
    if (!original) throw new Error(`Product ${id} not found`);
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = original;
    return this.createProduct({ ...rest, name: `${original.name} (kopia)` });
  }

  // ---- Stock snapshots ----
  listStockSnapshots(): StockSnapshot[] {
    return [...this.store.get('stockSnapshots', [])].sort(
      (a, b) => b.importedAt.localeCompare(a.importedAt),
    );
  }
  addStockSnapshot(snapshot: StockSnapshot): void {
    const all = [...this.store.get('stockSnapshots', []), snapshot];
    all.sort((a, b) => a.importedAt.localeCompare(b.importedAt));
    while (all.filter((s) => s.kind === snapshot.kind).length > STOCK_SNAPSHOT_RETENTION) {
      const idx = all.findIndex((s) => s.kind === snapshot.kind);
      if (idx === -1) break;
      all.splice(idx, 1);
    }
    this.store.set('stockSnapshots', all);
  }
  getCurrentSnapshot(kind: StockKind): StockSnapshot | undefined {
    const all = this.store.get('stockSnapshots', []);
    let latest: StockSnapshot | undefined;
    for (const s of all) {
      if (s.kind !== kind) continue;
      if (!latest || s.importedAt > latest.importedAt) latest = s;
    }
    return latest;
  }
  updateSnapshotRowMatch(
    snapshotId: string,
    rowKey: string,
    targetKind: 'raw' | 'component',
    targetId: string,
  ): void {
    const all = this.store.get('stockSnapshots', []);
    const idx = all.findIndex((s) => s.id === snapshotId);
    if (idx === -1) return;
    const rowIdx = all[idx].rows.findIndex((r) => r.rowKey === rowKey);
    if (rowIdx === -1) return;
    const row = all[idx].rows[rowIdx];
    if (targetKind === 'raw') {
      row.matchedRawMaterialId = targetId;
      row.matchedComponentId = undefined;
    } else {
      row.matchedComponentId = targetId;
      row.matchedRawMaterialId = undefined;
    }
    row.matchAmbiguous = false;
    row.matchConfidence = 1;
    this.store.set('stockSnapshots', all);
  }
  updateSnapshotRow(
    snapshotId: string,
    rowKey: string,
    patch: Partial<StockRow>,
  ): StockRow | undefined {
    const all = this.store.get('stockSnapshots', []);
    const idx = all.findIndex((s) => s.id === snapshotId);
    if (idx === -1) return undefined;
    const rowIdx = all[idx].rows.findIndex((r) => r.rowKey === rowKey);
    if (rowIdx === -1) return undefined;
    const { rowKey: _ignoredKey, ...safePatch } = patch;
    const updated: StockRow = { ...all[idx].rows[rowIdx], ...safePatch };
    all[idx].rows[rowIdx] = updated;
    this.store.set('stockSnapshots', all);
    return updated;
  }
  deleteSnapshotRow(snapshotId: string, rowKey: string): { ok: boolean } {
    const all = this.store.get('stockSnapshots', []);
    const idx = all.findIndex((s) => s.id === snapshotId);
    if (idx === -1) return { ok: false };
    all[idx].rows = all[idx].rows.filter((r) => r.rowKey !== rowKey);
    this.store.set('stockSnapshots', all);
    return { ok: true };
  }
  deleteSnapshot(snapshotId: string): { ok: boolean } {
    const all = this.store.get('stockSnapshots', []);
    const next = all.filter((s) => s.id !== snapshotId);
    if (next.length === all.length) return { ok: false };
    this.store.set('stockSnapshots', next);
    return { ok: true };
  }
  deleteSnapshotsByKind(kind: StockKind): { ok: boolean; deleted: number } {
    const all = this.store.get('stockSnapshots', []);
    const next = all.filter((s) => s.kind !== kind);
    this.store.set('stockSnapshots', next);
    return { ok: true, deleted: all.length - next.length };
  }

  // ---- Production plans ----
  listPlans(): ProductionPlan[] {
    return [...this.store.get('productionPlans', [])].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    );
  }
  getPlan(id: string): ProductionPlan | undefined {
    return this.store.get('productionPlans', []).find((p) => p.id === id);
  }
  createPlan(input: Omit<ProductionPlan, 'id' | 'createdAt' | 'updatedAt'>): ProductionPlan {
    const now = nowIso();
    const p: ProductionPlan = { ...input, id: newId(), createdAt: now, updatedAt: now };
    this.store.set('productionPlans', [...this.store.get('productionPlans', []), p]);
    return p;
  }
  updatePlan(
    id: string,
    patch: Partial<Omit<ProductionPlan, 'id' | 'createdAt'>>,
  ): ProductionPlan {
    const list = this.store.get('productionPlans', []);
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Plan ${id} not found`);
    const updated: ProductionPlan = { ...list[idx], ...patch, id, updatedAt: nowIso() };
    list[idx] = updated;
    this.store.set('productionPlans', list);
    return updated;
  }
  deletePlan(id: string): { ok: boolean } {
    this.store.set(
      'productionPlans',
      this.store.get('productionPlans', []).filter((p) => p.id !== id),
    );
    return { ok: true };
  }
  duplicatePlan(id: string): ProductionPlan {
    const original = this.getPlan(id);
    if (!original) throw new Error(`Plan ${id} not found`);
    const { id: _id, createdAt: _ca, updatedAt: _ua, computedAt: _cm, ...rest } = original;
    return this.createPlan({
      ...rest,
      name: `${original.name} (kopia)`,
      status: 'draft',
    });
  }

  // ---- Shortage report history ----
  listShortageReports(): ShortageReportEntry[] {
    return [...(this.store.get('shortageReports', []) ?? [])].sort(
      (a, b) => b.computedAt.localeCompare(a.computedAt),
    );
  }
  getShortageReport(id: string): ShortageReportEntry | undefined {
    return (this.store.get('shortageReports', []) ?? []).find((r) => r.id === id);
  }
  addShortageReport(planId: string, report: ShortageReport): ShortageReportEntry {
    const plan = this.getPlan(planId);
    const entry: ShortageReportEntry = {
      id: newId(),
      planId,
      planName: plan?.name ?? '?',
      computedAt: report.computedAt,
      report,
    };
    const all = [entry, ...(this.store.get('shortageReports', []) ?? [])];
    // Retain only the most recent N entries to keep the store bounded.
    const trimmed = all.slice(0, SHORTAGE_REPORT_RETENTION);
    this.store.set('shortageReports', trimmed);
    return entry;
  }
  deleteShortageReport(id: string): { ok: boolean } {
    const all = this.store.get('shortageReports', []) ?? [];
    this.store.set('shortageReports', all.filter((r) => r.id !== id));
    return { ok: true };
  }

  // ---- Settings ----
  getSettings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.store.get('settings', DEFAULT_SETTINGS) };
  }
  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const updated: AppSettings = {
      ...current,
      ...patch,
      llm: { ...current.llm, ...(patch.llm ?? {}) },
    };
    this.store.set('settings', updated);
    return updated;
  }

  // ---- Backup ----
  exportAll(): StoreSchema {
    return {
      schemaVersion: this.store.get('schemaVersion', STORE_SCHEMA_VERSION),
      suppliers: this.store.get('suppliers', []),
      rawMaterials: this.store.get('rawMaterials', []),
      components: this.store.get('components', []),
      products: this.store.get('products', []),
      stockSnapshots: this.store.get('stockSnapshots', []),
      productionPlans: this.store.get('productionPlans', []),
      shortageReports: this.store.get('shortageReports', []) ?? [],
      settings: this.getSettings(),
    };
  }
  importAll(data: StoreSchema, mode: 'merge' | 'replace'): { applied: number } {
    let applied = 0;
    if (mode === 'replace') {
      this.store.set('suppliers', data.suppliers ?? []);
      this.store.set('rawMaterials', data.rawMaterials ?? []);
      this.store.set('components', data.components ?? []);
      this.store.set('products', data.products ?? []);
      this.store.set('stockSnapshots', data.stockSnapshots ?? []);
      this.store.set('productionPlans', data.productionPlans ?? []);
      this.store.set('shortageReports', data.shortageReports ?? []);
      this.store.set('settings', { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) });
      applied =
        (data.suppliers?.length ?? 0) +
        (data.rawMaterials?.length ?? 0) +
        (data.components?.length ?? 0) +
        (data.products?.length ?? 0);
    } else {
      const mergeBy = <T extends { id: string }>(existing: T[], incoming: T[]): T[] => {
        const map = new Map(existing.map((e) => [e.id, e]));
        for (const item of incoming) {
          map.set(item.id, item);
          applied++;
        }
        return Array.from(map.values());
      };
      this.store.set(
        'suppliers',
        mergeBy(this.store.get('suppliers', []), data.suppliers ?? []),
      );
      this.store.set(
        'rawMaterials',
        mergeBy(this.store.get('rawMaterials', []), data.rawMaterials ?? []),
      );
      this.store.set(
        'components',
        mergeBy(this.store.get('components', []), data.components ?? []),
      );
      this.store.set('products', mergeBy(this.store.get('products', []), data.products ?? []));
      this.store.set(
        'productionPlans',
        mergeBy(this.store.get('productionPlans', []), data.productionPlans ?? []),
      );
    }
    return { applied };
  }
}
