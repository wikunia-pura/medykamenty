import Store from 'electron-store';
import type {
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
  EmailBatch,
  RFQEmailRecord,
  StoreSchema,
  CatalogAlias,
  ComponentType,
  UUID,
  Order,
  WorkflowTemplate,
  TaskTemplate,
  TaskInstance,
  TaskType,
  DateOnly,
  OrderStatus,
} from '../shared/types';
import {
  migrateLegacySecondaryPackaging,
  normalizeComponentSchema,
  normalizeProductSchema,
} from '../shared/types';
import { normalize as normalizeAlias } from './services/smartMatcher';
import log from './utils/logger';
import {
  DEFAULT_WASTE_FACTOR,
  DEFAULT_CURRENCY,
  DEFAULT_LANGUAGE,
  STOCK_SNAPSHOT_RETENTION,
  SHORTAGE_REPORT_RETENTION,
  EMAIL_BATCH_RETENTION,
} from '../shared/constants';
import { newId, nowIso } from './utils/id';
import { getSupabase } from './supabaseClient';

const DEFAULT_SETTINGS: AppSettings = {
  language: DEFAULT_LANGUAGE,
  darkMode: true,
  wasteFactor: DEFAULT_WASTE_FACTOR,
  defaultCurrency: DEFAULT_CURRENCY,
  defaultEmailLanguage: DEFAULT_LANGUAGE,
  llm: {
    useByDefault: false,
  },
};

function defaultReportName(planName: string, computedAt: string): string {
  const stamp = new Date(computedAt).toLocaleString();
  return `${planName} — ${stamp}`;
}

function withReportName(e: ShortageReportEntry): ShortageReportEntry {
  if (e.reportName) return e;
  return { ...e, reportName: defaultReportName(e.planName, e.computedAt) };
}

function withBatchReportName(b: EmailBatch): EmailBatch {
  let next = b;
  if (!next.reportName) {
    next = { ...next, reportName: defaultReportName(next.planName, next.reportComputedAt) };
  }
  // batchName is a separate user-facing label that defaults to the report name
  // for existing batches that predate the field.
  if (!next.batchName) {
    next = { ...next, batchName: next.reportName };
  }
  return next;
}

// Settings remain machine-local: language, dark mode, last import dir, llm prefs
// are per-user-machine UI prefs that shouldn't sync across installs.
interface SettingsStoreSchema {
  settings: AppSettings;
}

// --- Helpers ----------------------------------------------------------------

function unwrap<T>(data: T | null, error: { message: string } | null, context: string): T {
  if (error) throw new Error(`${context}: ${error.message}`);
  if (data === null) throw new Error(`${context}: no data returned`);
  return data;
}

// Strip id from an entity so we can store the rest in the JSONB `data` column.
function splitId<T extends { id: string }>(entity: T): { id: string; rest: Omit<T, 'id'> } {
  const { id, ...rest } = entity;
  return { id, rest };
}

// Reconstruct an entity from a Supabase row { id, data }.
function rebuild<T extends { id: string }>(row: { id: string; data: Record<string, unknown> }): T {
  return { ...row.data, id: row.id } as T;
}

// ===== Workflow task date math =====
// Tasks are sequential and dated as half-open day spans: task N starts the day
// after task N-1 ends, and the very first task starts on the order startDate.
// `endDate` is inclusive — durationDays=1 means start=end (single-day task).

function parseDate(d: DateOnly): Date {
  // Local-time midnight; pure date math, no timezone juggling.
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, day ?? 1);
}

function formatDate(d: Date): DateOnly {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: DateOnly, days: number): DateOnly {
  const date = parseDate(d);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function diffDaysInclusive(start: DateOnly, end: DateOnly): number {
  const ms = parseDate(end).getTime() - parseDate(start).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

function instantiateTasks(templateTasks: TaskTemplate[], orderStart: DateOnly): TaskInstance[] {
  const out: TaskInstance[] = [];
  let cursor = orderStart;
  for (const t of templateTasks) {
    const duration = Math.max(1, t.durationDays);
    const startDate = cursor;
    const endDate = addDays(startDate, duration - 1);
    out.push({
      id: newId(),
      name: t.name,
      type: t.type,
      status: 'todo',
      startDate,
      endDate,
    });
    cursor = addDays(endDate, 1);
  }
  return out;
}

// Reuses the existing per-task spans to derive their durations, then re-chains
// from `orderStart`. Used when the user edits the order's startDate or reorders.
function recomputeTaskDatesFromExisting<W extends { tasks: TaskInstance[] }>(
  wf: W,
  orderStart: DateOnly,
): W {
  let cursor = orderStart;
  const tasks: TaskInstance[] = wf.tasks.map(t => {
    const duration = diffDaysInclusive(t.startDate, t.endDate);
    const startDate = cursor;
    const endDate = addDays(startDate, duration - 1);
    cursor = addDays(endDate, 1);
    return { ...t, startDate, endDate };
  });
  return { ...wf, tasks };
}

// Variant that consumes a `_durationDays` hint stashed on a freshly-added task
// (no existing dates to derive from yet).
function recomputeTaskDatesFromDurations<W extends { tasks: TaskInstance[] }>(
  wf: W,
  orderStart: DateOnly,
): W {
  let cursor = orderStart;
  const tasks: TaskInstance[] = wf.tasks.map(t => {
    const stash = (t as TaskInstance & { _durationDays?: number })._durationDays;
    const duration =
      typeof stash === 'number' && stash > 0
        ? stash
        : diffDaysInclusive(t.startDate, t.endDate);
    const startDate = cursor;
    const endDate = addDays(startDate, duration - 1);
    cursor = addDays(endDate, 1);
    const { _durationDays: _, ...clean } = t as TaskInstance & { _durationDays?: number };
    return { ...clean, startDate, endDate };
  });
  return { ...wf, tasks };
}

// Public-facing recompute used by updateOrder when startDate changes.
function recomputeTaskDates<W extends { tasks: TaskInstance[] }>(
  wf: W,
  orderStart: DateOnly,
): W {
  return recomputeTaskDatesFromExisting(wf, orderStart);
}

// Derive order status from task statuses. `cancelled` is sticky — only the user
// can take an order out of it. Otherwise: all done → completed, any progress
// (in_progress or done) → in_progress, all todo → draft. No tasks → unchanged.
function deriveOrderStatus(
  current: OrderStatus,
  tasks: TaskInstance[],
): OrderStatus {
  if (current === 'cancelled') return 'cancelled';
  if (tasks.length === 0) return current;
  if (tasks.every(t => t.status === 'done')) return 'completed';
  if (tasks.some(t => t.status === 'in_progress' || t.status === 'done')) {
    return 'in_progress';
  }
  return 'draft';
}

export default class Database {
  private settingsStore: Store<SettingsStoreSchema>;

  constructor() {
    // Keep the default store file ('config.json' in userData) so existing
    // settings carry over. Legacy keys (suppliers, rawMaterials, …) remain in
    // place until the one-time importer reads them.
    this.settingsStore = new Store<SettingsStoreSchema>({
      defaults: { settings: DEFAULT_SETTINGS },
    });
  }

  // ============================== Suppliers ==============================

  async listSuppliers(): Promise<Supplier[]> {
    const { data, error } = await getSupabase().from('suppliers').select('id, data');
    const rows = unwrap(data, error, 'listSuppliers');
    return rows.map(r => rebuild<Supplier>(r)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getSupplier(id: string): Promise<Supplier | undefined> {
    const { data, error } = await getSupabase()
      .from('suppliers')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getSupplier: ${error.message}`);
    return data ? rebuild<Supplier>(data) : undefined;
  }

  async createSupplier(input: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Promise<Supplier> {
    const now = nowIso();
    const supplier: Supplier = { ...input, id: newId(), createdAt: now, updatedAt: now };
    const { rest } = splitId(supplier);
    const { error } = await getSupabase()
      .from('suppliers')
      .insert({ id: supplier.id, data: rest, updated_at: now });
    if (error) throw new Error(`createSupplier: ${error.message}`);
    return supplier;
  }

  async updateSupplier(
    id: string,
    patch: Partial<Omit<Supplier, 'id' | 'createdAt'>>,
  ): Promise<Supplier> {
    const existing = await this.getSupplier(id);
    if (!existing) throw new Error(`Supplier ${id} not found`);
    const updated: Supplier = { ...existing, ...patch, id, updatedAt: nowIso() };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('suppliers')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', id);
    if (error) throw new Error(`updateSupplier: ${error.message}`);
    return updated;
  }

  async duplicateSupplier(id: string): Promise<Supplier> {
    const original = await this.getSupplier(id);
    if (!original) throw new Error(`Supplier ${id} not found`);
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = original;
    return this.createSupplier({ ...rest, name: `${original.name} (kopia)` });
  }

  async deleteSupplier(id: string): Promise<{ ok: boolean; blockedBy?: string[] }> {
    const blockedBy: string[] = [];
    const rawMaterials = await this.listRawMaterials();
    for (const rm of rawMaterials) {
      if (rm.supplierIds.includes(id)) blockedBy.push(`raw:${rm.name}`);
    }
    const components = await this.listComponents();
    for (const c of components) {
      if (c.supplierIds.includes(id)) blockedBy.push(`component:${c.name}`);
    }
    if (blockedBy.length > 0) return { ok: false, blockedBy };
    const { error } = await getSupabase().from('suppliers').delete().eq('id', id);
    if (error) throw new Error(`deleteSupplier: ${error.message}`);
    return { ok: true };
  }

  // ============================ Raw materials ============================

  async listRawMaterials(): Promise<RawMaterial[]> {
    const { data, error } = await getSupabase().from('raw_materials').select('id, data');
    const rows = unwrap(data, error, 'listRawMaterials');
    return rows.map(r => rebuild<RawMaterial>(r)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getRawMaterial(id: string): Promise<RawMaterial | undefined> {
    const { data, error } = await getSupabase()
      .from('raw_materials')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getRawMaterial: ${error.message}`);
    return data ? rebuild<RawMaterial>(data) : undefined;
  }

  async createRawMaterial(
    input: Omit<RawMaterial, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<RawMaterial> {
    const now = nowIso();
    const rm: RawMaterial = { ...input, id: newId(), createdAt: now, updatedAt: now };
    const { rest } = splitId(rm);
    const { error } = await getSupabase()
      .from('raw_materials')
      .insert({ id: rm.id, data: rest, updated_at: now });
    if (error) throw new Error(`createRawMaterial: ${error.message}`);
    return rm;
  }

  async updateRawMaterial(
    id: string,
    patch: Partial<Omit<RawMaterial, 'id' | 'createdAt'>>,
  ): Promise<RawMaterial> {
    const existing = await this.getRawMaterial(id);
    if (!existing) throw new Error(`RawMaterial ${id} not found`);
    const updated: RawMaterial = { ...existing, ...patch, id, updatedAt: nowIso() };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('raw_materials')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', id);
    if (error) throw new Error(`updateRawMaterial: ${error.message}`);
    return updated;
  }

  async duplicateRawMaterial(id: string): Promise<RawMaterial> {
    const original = await this.getRawMaterial(id);
    if (!original) throw new Error(`RawMaterial ${id} not found`);
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = original;
    return this.createRawMaterial({ ...rest, name: `${original.name} (kopia)` });
  }

  async deleteRawMaterial(id: string): Promise<{ ok: boolean; blockedBy?: string[] }> {
    const blockedBy: string[] = [];
    const products = await this.listProducts();
    for (const p of products) {
      if (p.ingredients.some(i => i.rawMaterialId === id)) blockedBy.push(`product:${p.name}`);
    }
    if (blockedBy.length > 0) return { ok: false, blockedBy };
    const { error } = await getSupabase().from('raw_materials').delete().eq('id', id);
    if (error) throw new Error(`deleteRawMaterial: ${error.message}`);
    return { ok: true };
  }

  async setRawMaterialLastPrice(id: string, price: number, currency?: string): Promise<void> {
    const existing = await this.getRawMaterial(id);
    if (!existing) return;
    await this.updateRawMaterial(id, {
      lastPurchasePriceNet: price,
      currency: currency ?? existing.currency,
    });
  }

  // ============================== Components ==============================

  async listComponents(): Promise<PackagingComponent[]> {
    const { data, error } = await getSupabase().from('components').select('id, data');
    const rows = unwrap(data, error, 'listComponents');
    return rows
      .map(r => normalizeComponentSchema(rebuild<PackagingComponent>(r)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getComponent(id: string): Promise<PackagingComponent | undefined> {
    const { data, error } = await getSupabase()
      .from('components')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getComponent: ${error.message}`);
    return data ? normalizeComponentSchema(rebuild<PackagingComponent>(data)) : undefined;
  }

  async createComponent(
    input: Omit<PackagingComponent, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PackagingComponent> {
    const now = nowIso();
    const c: PackagingComponent = { ...input, id: newId(), createdAt: now, updatedAt: now };
    const { rest } = splitId(c);
    const { error } = await getSupabase()
      .from('components')
      .insert({ id: c.id, data: rest, updated_at: now });
    if (error) throw new Error(`createComponent: ${error.message}`);
    return c;
  }

  async updateComponent(
    id: string,
    patch: Partial<Omit<PackagingComponent, 'id' | 'createdAt'>>,
  ): Promise<PackagingComponent> {
    const existing = await this.getComponent(id);
    if (!existing) throw new Error(`Component ${id} not found`);
    const updated: PackagingComponent = { ...existing, ...patch, id, updatedAt: nowIso() };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('components')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', id);
    if (error) throw new Error(`updateComponent: ${error.message}`);
    return updated;
  }

  async duplicateComponent(id: string): Promise<PackagingComponent> {
    const original = await this.getComponent(id);
    if (!original) throw new Error(`Component ${id} not found`);
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = original;
    return this.createComponent({ ...rest, name: `${original.name} (kopia)` });
  }

  async deleteComponent(id: string): Promise<{ ok: boolean; blockedBy?: string[] }> {
    const blockedBy: string[] = [];
    const products = await this.listProducts();
    for (const p of products) {
      if (p.packaging.some(pkg => pkg.componentId === id)) {
        blockedBy.push(`product:${p.name}`);
        continue;
      }
      if (p.packingScheme?.tiers.some(t => t.componentId === id)) {
        blockedBy.push(`product:${p.name}`);
      }
    }
    // Also block if another component depends on this one (e.g. a carton
    // consumes this tape) — otherwise the cascade would dangle.
    const components = await this.listComponents();
    for (const c of components) {
      if (c.id === id) continue;
      if (c.dependencies?.some(d => d.componentId === id)) {
        blockedBy.push(`component:${c.name}`);
      }
    }
    if (blockedBy.length > 0) return { ok: false, blockedBy };
    const { error } = await getSupabase().from('components').delete().eq('id', id);
    if (error) throw new Error(`deleteComponent: ${error.message}`);
    return { ok: true };
  }

  async setComponentLastPrice(id: string, price: number, currency?: string): Promise<void> {
    const existing = await this.getComponent(id);
    if (!existing) return;
    await this.updateComponent(id, {
      lastPurchasePriceNet: price,
      currency: currency ?? existing.currency,
    });
  }

  // =============================== Aliases ===============================
  // User-trained mapping: when an import row's name matches a stored alias
  // (normalized) we auto-link it to the target catalog entry. Both raw
  // material and component aliases share the same shape; the helpers below
  // dispatch on the table name.

  private async listAliasesFor(table: 'raw_material_aliases' | 'component_aliases'): Promise<CatalogAlias[]> {
    const { data, error } = await getSupabase()
      .from(table)
      .select('id, target_id, alias, created_at');
    if (error) {
      // Schema not yet migrated → degrade gracefully so the rest of the import
      // still works. The user will see no auto-aliases until they run the SQL.
      if (/Could not find the table|does not exist|PGRST205/i.test(error.message)) {
        return [];
      }
      throw new Error(`${table}.list: ${error.message}`);
    }
    return (data ?? []).map((r: { id: string; target_id: string; alias: string; created_at: string }) => ({
      id: r.id,
      targetId: r.target_id,
      alias: r.alias,
      createdAt: r.created_at,
    }));
  }

  private async addAliasIn(
    table: 'raw_material_aliases' | 'component_aliases',
    targetId: string,
    alias: string,
  ): Promise<CatalogAlias> {
    const trimmed = alias.trim();
    if (!trimmed) throw new Error('alias is empty');
    const normalized = normalizeAlias(trimmed);
    if (!normalized) throw new Error('alias normalizes to empty string');
    const id = newId();
    const createdAt = nowIso();
    const { error } = await getSupabase()
      .from(table)
      .insert({ id, target_id: targetId, alias: trimmed, alias_normalized: normalized, created_at: createdAt });
    if (error) throw new Error(`${table}.add: ${error.message}`);
    return { id, targetId, alias: trimmed, createdAt };
  }

  private async deleteAliasIn(
    table: 'raw_material_aliases' | 'component_aliases',
    id: string,
  ): Promise<{ ok: boolean }> {
    const { error } = await getSupabase().from(table).delete().eq('id', id);
    if (error) throw new Error(`${table}.delete: ${error.message}`);
    return { ok: true };
  }

  listRawMaterialAliases(): Promise<CatalogAlias[]> {
    return this.listAliasesFor('raw_material_aliases');
  }
  addRawMaterialAlias(targetId: string, alias: string): Promise<CatalogAlias> {
    return this.addAliasIn('raw_material_aliases', targetId, alias);
  }
  deleteRawMaterialAlias(id: string): Promise<{ ok: boolean }> {
    return this.deleteAliasIn('raw_material_aliases', id);
  }
  listComponentAliases(): Promise<CatalogAlias[]> {
    return this.listAliasesFor('component_aliases');
  }
  addComponentAlias(targetId: string, alias: string): Promise<CatalogAlias> {
    return this.addAliasIn('component_aliases', targetId, alias);
  }
  deleteComponentAlias(id: string): Promise<{ ok: boolean }> {
    return this.deleteAliasIn('component_aliases', id);
  }

  // =============================== Products ===============================

  async listProducts(): Promise<Product[]> {
    const { data, error } = await getSupabase().from('products').select('id, data');
    const rows = unwrap(data, error, 'listProducts');
    const products = rows.map(r => normalizeProductSchema(rebuild<Product>(r)));
    // Lazy migration: move legacy secondary packaging entries (cartons, tape,
    // barrels) from `packaging[]` into `packingScheme.tiers[]`. Runs once
    // per product that still has the legacy shape; persists best-effort so
    // we don't repeat the work on every read.
    let typeMap: Map<UUID, ComponentType> | null = null;
    const migrated: Product[] = [];
    for (const p of products) {
      if (!p.packaging || p.packaging.length === 0) {
        migrated.push(p);
        continue;
      }
      if (!typeMap) {
        const comps = await this.listComponents();
        typeMap = new Map(comps.map(c => [c.id, c.type]));
      }
      const after = migrateLegacySecondaryPackaging(p, typeMap);
      if (after !== p) {
        try {
          const { rest } = splitId(after);
          await getSupabase()
            .from('products')
            .update({ data: rest, updated_at: after.updatedAt })
            .eq('id', after.id);
        } catch (err) {
          log.warn(`Lazy migration of product ${after.id} failed:`, err);
        }
      }
      migrated.push(after);
    }
    return migrated.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const { data, error } = await getSupabase()
      .from('products')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getProduct: ${error.message}`);
    if (!data) return undefined;
    const product = normalizeProductSchema(rebuild<Product>(data));
    // Same lazy migration as listProducts() — apply on the rare path where
    // a product is fetched by id without going through the list first.
    if (!product.packaging || product.packaging.length === 0) return product;
    const comps = await this.listComponents();
    const typeMap = new Map(comps.map(c => [c.id, c.type]));
    const after = migrateLegacySecondaryPackaging(product, typeMap);
    if (after !== product) {
      try {
        const { rest } = splitId(after);
        await getSupabase()
          .from('products')
          .update({ data: rest, updated_at: after.updatedAt })
          .eq('id', after.id);
      } catch (err) {
        log.warn(`Lazy migration of product ${after.id} failed:`, err);
      }
    }
    return after;
  }

  async createProduct(input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product> {
    const now = nowIso();
    const p: Product = { ...input, id: newId(), createdAt: now, updatedAt: now };
    const { rest } = splitId(p);
    const { error } = await getSupabase()
      .from('products')
      .insert({ id: p.id, data: rest, updated_at: now });
    if (error) throw new Error(`createProduct: ${error.message}`);
    return p;
  }

  async updateProduct(id: string, patch: Partial<Omit<Product, 'id' | 'createdAt'>>): Promise<Product> {
    const existing = await this.getProduct(id);
    if (!existing) throw new Error(`Product ${id} not found`);
    const updated: Product = { ...existing, ...patch, id, updatedAt: nowIso() };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('products')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', id);
    if (error) throw new Error(`updateProduct: ${error.message}`);
    return updated;
  }

  async deleteProduct(id: string): Promise<{ ok: boolean }> {
    const { error } = await getSupabase().from('products').delete().eq('id', id);
    if (error) throw new Error(`deleteProduct: ${error.message}`);
    return { ok: true };
  }

  async duplicateProduct(id: string): Promise<Product> {
    const original = await this.getProduct(id);
    if (!original) throw new Error(`Product ${id} not found`);
    const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = original;
    return this.createProduct({ ...rest, name: `${original.name} (kopia)` });
  }

  // ============================ Stock snapshots ============================

  async listStockSnapshots(): Promise<StockSnapshot[]> {
    const { data, error } = await getSupabase()
      .from('stock_snapshots')
      .select('id, data')
      .order('imported_at', { ascending: false });
    const rows = unwrap(data, error, 'listStockSnapshots');
    return rows.map(r => rebuild<StockSnapshot>(r));
  }

  async addStockSnapshot(snapshot: StockSnapshot): Promise<void> {
    const { rest } = splitId(snapshot);
    const { error } = await getSupabase().from('stock_snapshots').insert({
      id: snapshot.id,
      kind: snapshot.kind,
      imported_at: snapshot.importedAt,
      data: rest,
    });
    if (error) throw new Error(`addStockSnapshot: ${error.message}`);

    // Trim retention per-kind.
    const { data: kindRows, error: listErr } = await getSupabase()
      .from('stock_snapshots')
      .select('id, imported_at')
      .eq('kind', snapshot.kind)
      .order('imported_at', { ascending: false });
    if (listErr) return;
    const excess = (kindRows ?? []).slice(STOCK_SNAPSHOT_RETENTION);
    if (excess.length > 0) {
      await getSupabase()
        .from('stock_snapshots')
        .delete()
        .in('id', excess.map(r => r.id));
    }
  }

  async getCurrentSnapshot(kind: StockKind): Promise<StockSnapshot | undefined> {
    const { data, error } = await getSupabase()
      .from('stock_snapshots')
      .select('id, data')
      .eq('kind', kind)
      .order('imported_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`getCurrentSnapshot: ${error.message}`);
    return data ? rebuild<StockSnapshot>(data) : undefined;
  }

  async updateSnapshotRowMatch(
    snapshotId: string,
    rowKey: string,
    targetKind: 'raw' | 'component',
    targetId: string,
  ): Promise<void> {
    const snap = await this.getSnapshotById(snapshotId);
    if (!snap) return;
    const rowIdx = snap.rows.findIndex(r => r.rowKey === rowKey);
    if (rowIdx === -1) return;
    const row = { ...snap.rows[rowIdx] };
    if (targetKind === 'raw') {
      row.matchedRawMaterialId = targetId;
      row.matchedComponentId = undefined;
    } else {
      row.matchedComponentId = targetId;
      row.matchedRawMaterialId = undefined;
    }
    row.matchAmbiguous = false;
    row.matchConfidence = 1;
    snap.rows[rowIdx] = row;
    await this.persistSnapshot(snap);
  }

  async updateSnapshotRow(
    snapshotId: string,
    rowKey: string,
    patch: Partial<StockRow>,
  ): Promise<StockRow | undefined> {
    const snap = await this.getSnapshotById(snapshotId);
    if (!snap) return undefined;
    const rowIdx = snap.rows.findIndex(r => r.rowKey === rowKey);
    if (rowIdx === -1) return undefined;
    const { rowKey: _ignoredKey, ...safePatch } = patch;
    const updated: StockRow = { ...snap.rows[rowIdx], ...safePatch };
    snap.rows[rowIdx] = updated;
    await this.persistSnapshot(snap);
    return updated;
  }

  async deleteSnapshotRow(snapshotId: string, rowKey: string): Promise<{ ok: boolean }> {
    const snap = await this.getSnapshotById(snapshotId);
    if (!snap) return { ok: false };
    snap.rows = snap.rows.filter(r => r.rowKey !== rowKey);
    await this.persistSnapshot(snap);
    return { ok: true };
  }

  async deleteSnapshot(snapshotId: string): Promise<{ ok: boolean }> {
    const { error, count } = await getSupabase()
      .from('stock_snapshots')
      .delete({ count: 'exact' })
      .eq('id', snapshotId);
    if (error) throw new Error(`deleteSnapshot: ${error.message}`);
    return { ok: (count ?? 0) > 0 };
  }

  async deleteSnapshotsByKind(kind: StockKind): Promise<{ ok: boolean; deleted: number }> {
    const { error, count } = await getSupabase()
      .from('stock_snapshots')
      .delete({ count: 'exact' })
      .eq('kind', kind);
    if (error) throw new Error(`deleteSnapshotsByKind: ${error.message}`);
    return { ok: true, deleted: count ?? 0 };
  }

  private async getSnapshotById(id: string): Promise<StockSnapshot | undefined> {
    const { data, error } = await getSupabase()
      .from('stock_snapshots')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getSnapshotById: ${error.message}`);
    return data ? rebuild<StockSnapshot>(data) : undefined;
  }

  private async persistSnapshot(snap: StockSnapshot): Promise<void> {
    const { rest } = splitId(snap);
    const { error } = await getSupabase()
      .from('stock_snapshots')
      .update({ data: rest, imported_at: snap.importedAt, kind: snap.kind })
      .eq('id', snap.id);
    if (error) throw new Error(`persistSnapshot: ${error.message}`);
  }

  // =========================== Production plans ===========================

  async listPlans(): Promise<ProductionPlan[]> {
    const { data, error } = await getSupabase()
      .from('production_plans')
      .select('id, data')
      .order('updated_at', { ascending: false });
    const rows = unwrap(data, error, 'listPlans');
    // Sort by createdAt desc to match the legacy ordering.
    return rows
      .map(r => rebuild<ProductionPlan>(r))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getPlan(id: string): Promise<ProductionPlan | undefined> {
    const { data, error } = await getSupabase()
      .from('production_plans')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getPlan: ${error.message}`);
    return data ? rebuild<ProductionPlan>(data) : undefined;
  }

  async createPlan(
    input: Omit<ProductionPlan, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProductionPlan> {
    const now = nowIso();
    const p: ProductionPlan = { ...input, id: newId(), createdAt: now, updatedAt: now };
    const { rest } = splitId(p);
    const { error } = await getSupabase()
      .from('production_plans')
      .insert({ id: p.id, data: rest, updated_at: now });
    if (error) throw new Error(`createPlan: ${error.message}`);
    return p;
  }

  async updatePlan(
    id: string,
    patch: Partial<Omit<ProductionPlan, 'id' | 'createdAt'>>,
  ): Promise<ProductionPlan> {
    const existing = await this.getPlan(id);
    if (!existing) throw new Error(`Plan ${id} not found`);
    const updated: ProductionPlan = { ...existing, ...patch, id, updatedAt: nowIso() };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('production_plans')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', id);
    if (error) throw new Error(`updatePlan: ${error.message}`);
    return updated;
  }

  async deletePlan(id: string): Promise<{ ok: boolean }> {
    const { error } = await getSupabase().from('production_plans').delete().eq('id', id);
    if (error) throw new Error(`deletePlan: ${error.message}`);
    return { ok: true };
  }

  async duplicatePlan(id: string): Promise<ProductionPlan> {
    const original = await this.getPlan(id);
    if (!original) throw new Error(`Plan ${id} not found`);
    const { id: _id, createdAt: _ca, updatedAt: _ua, computedAt: _cm, ...rest } = original;
    return this.createPlan({
      ...rest,
      name: `${original.name} (kopia)`,
      status: 'draft',
    });
  }

  // ============================ Shortage reports ============================

  async listShortageReports(): Promise<ShortageReportEntry[]> {
    const { data, error } = await getSupabase()
      .from('shortage_reports')
      .select('id, data')
      .order('computed_at', { ascending: false });
    const rows = unwrap(data, error, 'listShortageReports');
    return rows.map(r => withReportName(rebuild<ShortageReportEntry>(r)));
  }

  async getShortageReport(id: string): Promise<ShortageReportEntry | undefined> {
    const { data, error } = await getSupabase()
      .from('shortage_reports')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getShortageReport: ${error.message}`);
    return data ? withReportName(rebuild<ShortageReportEntry>(data)) : undefined;
  }

  async addShortageReport(
    planId: string,
    report: ShortageReport,
    orderId?: string,
  ): Promise<ShortageReportEntry> {
    const plan = await this.getPlan(planId);
    const planName = plan?.name ?? '?';
    const entry: ShortageReportEntry = {
      id: newId(),
      planId,
      planName,
      reportName: defaultReportName(planName, report.computedAt),
      computedAt: report.computedAt,
      report,
      ...(orderId ? { orderId } : {}),
    };
    const { rest } = splitId(entry);
    const { error } = await getSupabase().from('shortage_reports').insert({
      id: entry.id,
      plan_id: planId,
      computed_at: entry.computedAt,
      data: rest,
      ...(orderId ? { order_id: orderId } : {}),
    });
    if (error) throw new Error(`addShortageReport: ${error.message}`);

    // Retention trim.
    const { data: all, error: listErr } = await getSupabase()
      .from('shortage_reports')
      .select('id, computed_at')
      .order('computed_at', { ascending: false });
    if (!listErr && all) {
      const excess = all.slice(SHORTAGE_REPORT_RETENTION);
      if (excess.length > 0) {
        await getSupabase()
          .from('shortage_reports')
          .delete()
          .in('id', excess.map(r => r.id));
      }
    }
    return entry;
  }

  async deleteShortageReport(id: string): Promise<{ ok: boolean }> {
    const { error } = await getSupabase().from('shortage_reports').delete().eq('id', id);
    if (error) throw new Error(`deleteShortageReport: ${error.message}`);
    return { ok: true };
  }

  async updateShortageReport(
    id: string,
    patch: { reportName?: string; orderId?: string | null; archived?: boolean },
  ): Promise<ShortageReportEntry | undefined> {
    const existing = await this.getShortageReport(id);
    if (!existing) return undefined;
    const next: ShortageReportEntry = withReportName({ ...existing });
    if (patch.reportName !== undefined) next.reportName = patch.reportName;
    if (patch.orderId !== undefined) {
      // null clears the link; undefined leaves it alone.
      if (patch.orderId === null) delete next.orderId;
      else next.orderId = patch.orderId;
    }
    if (patch.archived !== undefined) {
      if (patch.archived) next.archived = true;
      else delete next.archived;
    }
    const { rest } = splitId(next);
    // Mirror order_id on the top-level column so list filters keep working.
    const update: Record<string, unknown> = { data: rest };
    if (patch.orderId !== undefined) update.order_id = patch.orderId;
    const { error } = await getSupabase()
      .from('shortage_reports')
      .update(update)
      .eq('id', id);
    if (error) throw new Error(`updateShortageReport: ${error.message}`);

    // Cascade order link and archived flag to any email batches generated
    // from this report — OrderDetails filters batches by orderId, and the
    // email batch list hides archived entries.
    if (patch.orderId !== undefined || patch.archived !== undefined) {
      const { data: batchRows, error: batchListErr } = await getSupabase()
        .from('email_batches')
        .select('id, data')
        .eq('report_id', id);
      if (batchListErr) {
        throw new Error(`updateShortageReport: ${batchListErr.message}`);
      }
      for (const row of batchRows ?? []) {
        const batch = rebuild<EmailBatch>(row);
        if (patch.orderId !== undefined) {
          if (patch.orderId === null) delete batch.orderId;
          else batch.orderId = patch.orderId;
        }
        if (patch.archived !== undefined) {
          if (patch.archived) batch.archived = true;
          else delete batch.archived;
        }
        const { rest } = splitId(batch);
        const batchUpdate: Record<string, unknown> = { data: rest };
        if (patch.orderId !== undefined) batchUpdate.order_id = patch.orderId;
        const { error: upErr } = await getSupabase()
          .from('email_batches')
          .update(batchUpdate)
          .eq('id', row.id);
        if (upErr) throw new Error(`updateShortageReport: ${upErr.message}`);
      }
    }

    return next;
  }

  async setReportSupplierReceived(
    reportId: string,
    supplierId: string,
    receivedAt: string | null,
  ): Promise<ShortageReportEntry | undefined> {
    const existing = await this.getShortageReport(reportId);
    if (!existing) return undefined;
    const next: ShortageReportEntry = withReportName({ ...existing });
    const receipts = (next.supplierReceipts ?? []).filter(
      (r) => r.supplierId !== supplierId,
    );
    if (receivedAt) receipts.push({ supplierId, receivedAt });
    next.supplierReceipts = receipts;
    const { rest } = splitId(next);
    const { error } = await getSupabase()
      .from('shortage_reports')
      .update({ data: rest })
      .eq('id', reportId);
    if (error) throw new Error(`setReportSupplierReceived: ${error.message}`);
    return next;
  }

  // ============================= Email batches =============================

  async listEmailBatches(): Promise<EmailBatch[]> {
    const { data, error } = await getSupabase()
      .from('email_batches')
      .select('id, data')
      .order('generated_at', { ascending: false });
    const rows = unwrap(data, error, 'listEmailBatches');
    return rows.map(r => withBatchReportName(rebuild<EmailBatch>(r)));
  }

  async getEmailBatch(id: string): Promise<EmailBatch | undefined> {
    const { data, error } = await getSupabase()
      .from('email_batches')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getEmailBatch: ${error.message}`);
    return data ? withBatchReportName(rebuild<EmailBatch>(data)) : undefined;
  }

  async addEmailBatch(batch: EmailBatch): Promise<EmailBatch> {
    const { rest } = splitId(batch);
    const { error } = await getSupabase().from('email_batches').insert({
      id: batch.id,
      report_id: batch.reportId,
      plan_id: batch.planId,
      generated_at: batch.generatedAt,
      data: rest,
      ...(batch.orderId ? { order_id: batch.orderId } : {}),
    });
    if (error) throw new Error(`addEmailBatch: ${error.message}`);

    // Retention trim.
    const { data: all, error: listErr } = await getSupabase()
      .from('email_batches')
      .select('id, generated_at')
      .order('generated_at', { ascending: false });
    if (!listErr && all) {
      const excess = all.slice(EMAIL_BATCH_RETENTION);
      if (excess.length > 0) {
        await getSupabase()
          .from('email_batches')
          .delete()
          .in('id', excess.map(r => r.id));
      }
    }
    return batch;
  }

  async deleteEmailBatch(id: string): Promise<{ ok: boolean }> {
    const { error } = await getSupabase().from('email_batches').delete().eq('id', id);
    if (error) throw new Error(`deleteEmailBatch: ${error.message}`);
    return { ok: true };
  }

  async updateEmailBatch(
    id: string,
    patch: { batchName?: string; orderId?: string | null },
  ): Promise<EmailBatch | undefined> {
    const existing = await this.getEmailBatch(id);
    if (!existing) return undefined;
    const next: EmailBatch = withBatchReportName({ ...existing });
    if (patch.batchName !== undefined) next.batchName = patch.batchName;
    if (patch.orderId !== undefined) {
      if (patch.orderId === null) delete next.orderId;
      else next.orderId = patch.orderId;
    }
    const { rest } = splitId(next);
    const update: Record<string, unknown> = { data: rest };
    if (patch.orderId !== undefined) update.order_id = patch.orderId;
    const { error } = await getSupabase()
      .from('email_batches')
      .update(update)
      .eq('id', id);
    if (error) throw new Error(`updateEmailBatch: ${error.message}`);
    return next;
  }

  async updateBatchEmail(
    batchId: string,
    emailId: string,
    patch: Partial<Omit<RFQEmailRecord, 'id'>>,
  ): Promise<EmailBatch | undefined> {
    const existing = await this.getEmailBatch(batchId);
    if (!existing) return undefined;
    const eIdx = existing.emails.findIndex(e => e.id === emailId);
    if (eIdx === -1) return undefined;
    existing.emails[eIdx] = { ...existing.emails[eIdx], ...patch };
    const { rest } = splitId(existing);
    const { error } = await getSupabase()
      .from('email_batches')
      .update({ data: rest })
      .eq('id', batchId);
    if (error) throw new Error(`updateBatchEmail: ${error.message}`);
    return existing;
  }

  async markEmailSent(
    batchId: string,
    emailId: string,
    sentAt: string | null,
  ): Promise<EmailBatch | undefined> {
    return this.updateBatchEmail(batchId, emailId, {
      sentAt: sentAt ?? undefined,
    });
  }

  // ============================ Workflow templates ============================

  async listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
    const { data, error } = await getSupabase()
      .from('workflow_templates')
      .select('id, data')
      .order('updated_at', { ascending: false });
    const rows = unwrap(data, error, 'listWorkflowTemplates');
    return rows.map(r => rebuild<WorkflowTemplate>(r));
  }

  async getWorkflowTemplate(id: string): Promise<WorkflowTemplate | undefined> {
    const { data, error } = await getSupabase()
      .from('workflow_templates')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getWorkflowTemplate: ${error.message}`);
    return data ? rebuild<WorkflowTemplate>(data) : undefined;
  }

  async createWorkflowTemplate(
    input: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowTemplate> {
    const now = nowIso();
    const wt: WorkflowTemplate = { ...input, id: newId(), createdAt: now, updatedAt: now };
    const { rest } = splitId(wt);
    const { error } = await getSupabase()
      .from('workflow_templates')
      .insert({ id: wt.id, data: rest, updated_at: now });
    if (error) throw new Error(`createWorkflowTemplate: ${error.message}`);
    return wt;
  }

  async updateWorkflowTemplate(
    id: string,
    patch: Partial<Omit<WorkflowTemplate, 'id' | 'createdAt'>>,
  ): Promise<WorkflowTemplate> {
    const existing = await this.getWorkflowTemplate(id);
    if (!existing) throw new Error(`WorkflowTemplate ${id} not found`);
    const updated: WorkflowTemplate = { ...existing, ...patch, id, updatedAt: nowIso() };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('workflow_templates')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', id);
    if (error) throw new Error(`updateWorkflowTemplate: ${error.message}`);
    return updated;
  }

  async duplicateWorkflowTemplate(id: string): Promise<WorkflowTemplate> {
    const original = await this.getWorkflowTemplate(id);
    if (!original) throw new Error(`WorkflowTemplate ${id} not found`);
    const { id: _id, createdAt: _ca, updatedAt: _ua, tasks, ...rest } = original;
    return this.createWorkflowTemplate({
      ...rest,
      name: `${original.name} (kopia)`,
      tasks: tasks.map(t => ({ ...t, id: newId() })),
    });
  }

  async deleteWorkflowTemplate(id: string): Promise<{ ok: boolean }> {
    const { error } = await getSupabase().from('workflow_templates').delete().eq('id', id);
    if (error) throw new Error(`deleteWorkflowTemplate: ${error.message}`);
    return { ok: true };
  }

  // ================================ Orders ================================

  async listOrders(): Promise<Order[]> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('id, data')
      .order('updated_at', { ascending: false });
    const rows = unwrap(data, error, 'listOrders');
    return rows
      .map(r => rebuild<Order>(r))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getOrder(id: string): Promise<Order | undefined> {
    const { data, error } = await getSupabase()
      .from('orders')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getOrder: ${error.message}`);
    return data ? rebuild<Order>(data) : undefined;
  }

  async createOrder(input: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Promise<Order> {
    const now = nowIso();
    const order: Order = { ...input, id: newId(), createdAt: now, updatedAt: now };
    const { rest } = splitId(order);
    const { error } = await getSupabase()
      .from('orders')
      .insert({ id: order.id, data: rest, updated_at: now });
    if (error) throw new Error(`createOrder: ${error.message}`);
    return order;
  }

  async updateOrder(
    id: string,
    patch: Partial<Omit<Order, 'id' | 'createdAt'>>,
  ): Promise<Order> {
    const existing = await this.getOrder(id);
    if (!existing) throw new Error(`Order ${id} not found`);
    const updated: Order = { ...existing, ...patch, id, updatedAt: nowIso() };
    // Recompute task dates if startDate changed and a workflow is attached —
    // tasks are sequential and chained off the order startDate.
    if (
      patch.startDate !== undefined &&
      patch.startDate !== existing.startDate &&
      updated.workflow
    ) {
      updated.workflow = recomputeTaskDates(updated.workflow, updated.startDate);
    }
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('orders')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', id);
    if (error) throw new Error(`updateOrder: ${error.message}`);
    return updated;
  }

  async duplicateOrder(id: string): Promise<Order> {
    const original = await this.getOrder(id);
    if (!original) throw new Error(`Order ${id} not found`);
    const { id: _id, createdAt: _ca, updatedAt: _ua, workflow, ...rest } = original;
    const duplicatedWorkflow = workflow
      ? {
          ...workflow,
          tasks: workflow.tasks.map(t => ({
            ...t,
            id: newId(),
            status: 'todo' as const,
            completedAt: undefined,
          })),
        }
      : undefined;
    return this.createOrder({
      ...rest,
      name: `${original.name} (kopia)`,
      status: 'draft',
      ...(duplicatedWorkflow ? { workflow: duplicatedWorkflow } : {}),
    });
  }

  async deleteOrder(id: string): Promise<{ ok: boolean }> {
    // Clear order_id on linked reports/batches (don't cascade-delete — user may
    // want to keep the report history even after deleting the order).
    await getSupabase().from('shortage_reports').update({ order_id: null }).eq('order_id', id);
    await getSupabase().from('email_batches').update({ order_id: null }).eq('order_id', id);
    const { error } = await getSupabase().from('orders').delete().eq('id', id);
    if (error) throw new Error(`deleteOrder: ${error.message}`);
    return { ok: true };
  }

  async attachWorkflowToOrder(orderId: string, templateId: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    const template = await this.getWorkflowTemplate(templateId);
    if (!template) throw new Error(`WorkflowTemplate ${templateId} not found`);
    const tasks = instantiateTasks(template.tasks, order.startDate);
    const updated: Order = {
      ...order,
      workflow: {
        templateId: template.id,
        templateName: template.name,
        tasks,
      },
      updatedAt: nowIso(),
    };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('orders')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', orderId);
    if (error) throw new Error(`attachWorkflowToOrder: ${error.message}`);
    return updated;
  }

  async detachWorkflowFromOrder(orderId: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    const { workflow: _workflow, ...withoutWorkflow } = order;
    const updated: Order = { ...withoutWorkflow, updatedAt: nowIso() };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('orders')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', orderId);
    if (error) throw new Error(`detachWorkflowFromOrder: ${error.message}`);
    return updated;
  }

  async updateOrderTask(
    orderId: string,
    taskId: string,
    patch: Partial<TaskInstance>,
  ): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order || !order.workflow) throw new Error(`Order ${orderId} has no workflow`);
    const idx = order.workflow.tasks.findIndex(t => t.id === taskId);
    if (idx === -1) throw new Error(`Task ${taskId} not found`);
    const prev = order.workflow.tasks[idx];
    const next: TaskInstance = { ...prev, ...patch, id: taskId };
    // Auto-stamp completedAt when transitioning to done; clear it otherwise.
    if (patch.status !== undefined) {
      next.completedAt = patch.status === 'done' ? nowIso() : undefined;
    }
    // Normalize note: trim, and drop the field entirely when blank.
    if (patch.note !== undefined) {
      const trimmed = patch.note?.trim();
      if (trimmed) next.note = trimmed;
      else delete next.note;
    }
    const tasks = [...order.workflow.tasks];
    tasks[idx] = next;
    const updated: Order = {
      ...order,
      status: deriveOrderStatus(order.status, tasks),
      workflow: { ...order.workflow, tasks },
      updatedAt: nowIso(),
    };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('orders')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', orderId);
    if (error) throw new Error(`updateOrderTask: ${error.message}`);
    return updated;
  }

  async addOrderTask(
    orderId: string,
    input: { name: string; type: TaskType; durationDays: number; note?: string },
    insertAtIndex?: number,
  ): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order) throw new Error(`Order ${orderId} not found`);
    const wf = order.workflow ?? { tasks: [] };
    const tasks = [...wf.tasks];
    // Provisional dates — recomputeTaskDates() below overwrites with the
    // proper chain based on durationDays and the order startDate.
    const newTask: TaskInstance = {
      id: newId(),
      name: input.name,
      type: input.type,
      status: 'todo',
      startDate: order.startDate,
      endDate: order.startDate,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    };
    // Stash durationDays on the task so the chain recomputation can read it.
    (newTask as TaskInstance & { _durationDays?: number })._durationDays = input.durationDays;
    const at = insertAtIndex ?? tasks.length;
    tasks.splice(Math.max(0, Math.min(tasks.length, at)), 0, newTask);
    // Diverged from template now — clear templateId so we don't pretend.
    const newWf = { ...wf, tasks, templateId: undefined };
    const recomputed = recomputeTaskDatesFromDurations(newWf, order.startDate);
    const updated: Order = {
      ...order,
      status: deriveOrderStatus(order.status, recomputed.tasks),
      workflow: recomputed,
      updatedAt: nowIso(),
    };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('orders')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', orderId);
    if (error) throw new Error(`addOrderTask: ${error.message}`);
    return updated;
  }

  async deleteOrderTask(orderId: string, taskId: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order || !order.workflow) throw new Error(`Order ${orderId} has no workflow`);
    const tasks = order.workflow.tasks.filter(t => t.id !== taskId);
    const updated: Order = {
      ...order,
      status: deriveOrderStatus(order.status, tasks),
      workflow: { ...order.workflow, tasks, templateId: undefined },
      updatedAt: nowIso(),
    };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('orders')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', orderId);
    if (error) throw new Error(`deleteOrderTask: ${error.message}`);
    return updated;
  }

  async reorderOrderTasks(
    orderId: string,
    fromIndex: number,
    toIndex: number,
  ): Promise<Order> {
    const order = await this.getOrder(orderId);
    if (!order || !order.workflow) throw new Error(`Order ${orderId} has no workflow`);
    const tasks = [...order.workflow.tasks];
    if (fromIndex < 0 || fromIndex >= tasks.length || toIndex < 0 || toIndex >= tasks.length) {
      return order;
    }
    const [moved] = tasks.splice(fromIndex, 1);
    tasks.splice(toIndex, 0, moved);
    // Reorder shifts each task's place in the chain — recompute dates so the
    // sequence still starts at the order startDate.
    const newWf = { ...order.workflow, tasks, templateId: undefined };
    const recomputed = recomputeTaskDatesFromExisting(newWf, order.startDate);
    const updated: Order = {
      ...order,
      workflow: recomputed,
      updatedAt: nowIso(),
    };
    const { rest } = splitId(updated);
    const { error } = await getSupabase()
      .from('orders')
      .update({ data: rest, updated_at: updated.updatedAt })
      .eq('id', orderId);
    if (error) throw new Error(`reorderOrderTasks: ${error.message}`);
    return updated;
  }

  // =============================== Settings ===============================
  // Stay local to the machine — UI prefs, not shared data.

  getSettings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.settingsStore.get('settings', DEFAULT_SETTINGS) };
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    const current = this.getSettings();
    const updated: AppSettings = {
      ...current,
      ...patch,
      llm: { ...current.llm, ...(patch.llm ?? {}) },
    };
    this.settingsStore.set('settings', updated);
    return updated;
  }

  // =============================== Backup ===============================

  async exportAll(): Promise<StoreSchema> {
    const [
      suppliers,
      rawMaterials,
      components,
      products,
      stockSnapshots,
      productionPlans,
      shortageReports,
      emailBatches,
      orders,
      workflowTemplates,
    ] = await Promise.all([
      this.listSuppliers(),
      this.listRawMaterials(),
      this.listComponents(),
      this.listProducts(),
      this.listStockSnapshots(),
      this.listPlans(),
      this.listShortageReports(),
      this.listEmailBatches(),
      this.listOrders().catch(() => [] as Order[]),
      this.listWorkflowTemplates().catch(() => [] as WorkflowTemplate[]),
    ]);
    return {
      schemaVersion: 1,
      suppliers,
      rawMaterials,
      components,
      products,
      stockSnapshots,
      productionPlans,
      shortageReports,
      emailBatches,
      orders,
      workflowTemplates,
      settings: this.getSettings(),
    };
  }

  async importAll(data: StoreSchema, mode: 'merge' | 'replace'): Promise<{ applied: number }> {
    let applied = 0;
    const supa = getSupabase();
    if (mode === 'replace') {
      await Promise.all([
        supa.from('suppliers').delete().not('id', 'is', null),
        supa.from('raw_materials').delete().not('id', 'is', null),
        supa.from('components').delete().not('id', 'is', null),
        supa.from('products').delete().not('id', 'is', null),
        supa.from('stock_snapshots').delete().not('id', 'is', null),
        supa.from('production_plans').delete().not('id', 'is', null),
        supa.from('shortage_reports').delete().not('id', 'is', null),
        supa.from('email_batches').delete().not('id', 'is', null),
        supa.from('orders').delete().not('id', 'is', null),
        supa.from('workflow_templates').delete().not('id', 'is', null),
      ]);
    }

    const bulkUpsert = async <T extends { id: string }>(
      table: string,
      list: T[],
      extra?: (e: T) => Record<string, unknown>,
    ): Promise<number> => {
      if (list.length === 0) return 0;
      const rows = list.map(item => {
        const { rest } = splitId(item);
        return { id: item.id, data: rest, ...(extra ? extra(item) : {}) };
      });
      const { error } = await supa.from(table).upsert(rows);
      if (error) throw new Error(`importAll ${table}: ${error.message}`);
      return list.length;
    };

    applied += await bulkUpsert('suppliers', data.suppliers ?? [], () => ({ updated_at: nowIso() }));
    applied += await bulkUpsert(
      'raw_materials',
      data.rawMaterials ?? [],
      () => ({ updated_at: nowIso() }),
    );
    applied += await bulkUpsert(
      'components',
      data.components ?? [],
      () => ({ updated_at: nowIso() }),
    );
    applied += await bulkUpsert(
      'products',
      data.products ?? [],
      () => ({ updated_at: nowIso() }),
    );
    applied += await bulkUpsert(
      'stock_snapshots',
      data.stockSnapshots ?? [],
      s => ({ kind: s.kind, imported_at: s.importedAt }),
    );
    applied += await bulkUpsert(
      'production_plans',
      data.productionPlans ?? [],
      () => ({ updated_at: nowIso() }),
    );
    applied += await bulkUpsert(
      'shortage_reports',
      data.shortageReports ?? [],
      e => ({ plan_id: e.planId, computed_at: e.computedAt }),
    );
    applied += await bulkUpsert(
      'email_batches',
      data.emailBatches ?? [],
      b => ({
        report_id: b.reportId,
        plan_id: b.planId,
        generated_at: b.generatedAt,
        ...(b.orderId ? { order_id: b.orderId } : {}),
      }),
    );
    applied += await bulkUpsert(
      'orders',
      data.orders ?? [],
      () => ({ updated_at: nowIso() }),
    );
    applied += await bulkUpsert(
      'workflow_templates',
      data.workflowTemplates ?? [],
      () => ({ updated_at: nowIso() }),
    );

    if (data.settings) {
      this.settingsStore.set('settings', { ...DEFAULT_SETTINGS, ...data.settings });
    }
    return { applied };
  }
}
