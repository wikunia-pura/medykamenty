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
} from '../shared/types';
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
  if (b.reportName) return b;
  return { ...b, reportName: defaultReportName(b.planName, b.reportComputedAt) };
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
      .map(r => rebuild<PackagingComponent>(r))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getComponent(id: string): Promise<PackagingComponent | undefined> {
    const { data, error } = await getSupabase()
      .from('components')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getComponent: ${error.message}`);
    return data ? rebuild<PackagingComponent>(data) : undefined;
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

  async deleteComponent(id: string): Promise<{ ok: boolean; blockedBy?: string[] }> {
    const blockedBy: string[] = [];
    const products = await this.listProducts();
    for (const p of products) {
      if (p.packaging.some(pkg => pkg.componentId === id)) blockedBy.push(`product:${p.name}`);
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

  // =============================== Products ===============================

  async listProducts(): Promise<Product[]> {
    const { data, error } = await getSupabase().from('products').select('id, data');
    const rows = unwrap(data, error, 'listProducts');
    return rows.map(r => rebuild<Product>(r)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const { data, error } = await getSupabase()
      .from('products')
      .select('id, data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getProduct: ${error.message}`);
    return data ? rebuild<Product>(data) : undefined;
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

  async addShortageReport(planId: string, report: ShortageReport): Promise<ShortageReportEntry> {
    const plan = await this.getPlan(planId);
    const planName = plan?.name ?? '?';
    const entry: ShortageReportEntry = {
      id: newId(),
      planId,
      planName,
      reportName: defaultReportName(planName, report.computedAt),
      computedAt: report.computedAt,
      report,
    };
    const { rest } = splitId(entry);
    const { error } = await getSupabase().from('shortage_reports').insert({
      id: entry.id,
      plan_id: planId,
      computed_at: entry.computedAt,
      data: rest,
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
    patch: { reportName?: string },
  ): Promise<ShortageReportEntry | undefined> {
    const existing = await this.getShortageReport(id);
    if (!existing) return undefined;
    const next: ShortageReportEntry = withReportName({ ...existing });
    if (patch.reportName !== undefined) next.reportName = patch.reportName;
    const { rest } = splitId(next);
    const { error } = await getSupabase()
      .from('shortage_reports')
      .update({ data: rest })
      .eq('id', id);
    if (error) throw new Error(`updateShortageReport: ${error.message}`);
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
    ] = await Promise.all([
      this.listSuppliers(),
      this.listRawMaterials(),
      this.listComponents(),
      this.listProducts(),
      this.listStockSnapshots(),
      this.listPlans(),
      this.listShortageReports(),
      this.listEmailBatches(),
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
      b => ({ report_id: b.reportId, plan_id: b.planId, generated_at: b.generatedAt }),
    );

    if (data.settings) {
      this.settingsStore.set('settings', { ...DEFAULT_SETTINGS, ...data.settings });
    }
    return { applied };
  }
}
