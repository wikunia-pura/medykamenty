import fs from 'fs';
import path from 'path';
import Store from 'electron-store';
import type {
  Supplier,
  RawMaterial,
  PackagingComponent,
  Product,
  StockSnapshot,
  ProductionPlan,
  ShortageReportEntry,
  EmailBatch,
} from '../shared/types';
import Database from './database';
import log from './utils/logger';
import { localDateIso } from '../shared/dates';

// Reads the legacy electron-store (config.json) where business entities lived
// before the Supabase migration, and pushes them up to the cloud.
//
// Idempotent: once `migration_done` is set true, the importer is a no-op.

interface LegacyStoreSchema {
  suppliers?: Supplier[];
  rawMaterials?: RawMaterial[];
  components?: PackagingComponent[];
  products?: Product[];
  stockSnapshots?: StockSnapshot[];
  productionPlans?: ProductionPlan[];
  shortageReports?: ShortageReportEntry[];
  emailBatches?: EmailBatch[];
  migration_done?: boolean;
}

function getLegacyStore(): Store<LegacyStoreSchema> {
  return new Store<LegacyStoreSchema>({ defaults: {} });
}

export interface MigrationStatus {
  hasLocalData: boolean;
  migrated: boolean;
  counts: {
    suppliers: number;
    rawMaterials: number;
    components: number;
    products: number;
    stockSnapshots: number;
    productionPlans: number;
    shortageReports: number;
    emailBatches: number;
  };
}

export function getMigrationStatus(): MigrationStatus {
  const store = getLegacyStore();
  const counts = {
    suppliers: (store.get('suppliers') ?? []).length,
    rawMaterials: (store.get('rawMaterials') ?? []).length,
    components: (store.get('components') ?? []).length,
    products: (store.get('products') ?? []).length,
    stockSnapshots: (store.get('stockSnapshots') ?? []).length,
    productionPlans: (store.get('productionPlans') ?? []).length,
    shortageReports: (store.get('shortageReports') ?? []).length,
    emailBatches: (store.get('emailBatches') ?? []).length,
  };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { hasLocalData: total > 0, migrated: store.get('migration_done') === true, counts };
}

export async function runMigration(
  database: Database,
): Promise<
  | { ok: true; counts: MigrationStatus['counts'] }
  | { ok: false; error: string }
> {
  const store = getLegacyStore();
  if (store.get('migration_done') === true) {
    return {
      ok: true,
      counts: {
        suppliers: 0,
        rawMaterials: 0,
        components: 0,
        products: 0,
        stockSnapshots: 0,
        productionPlans: 0,
        shortageReports: 0,
        emailBatches: 0,
      },
    };
  }

  const suppliers = store.get('suppliers') ?? [];
  const rawMaterials = store.get('rawMaterials') ?? [];
  const components = store.get('components') ?? [];
  const products = store.get('products') ?? [];
  const stockSnapshots = store.get('stockSnapshots') ?? [];
  const productionPlans = store.get('productionPlans') ?? [];
  const shortageReports = store.get('shortageReports') ?? [];
  const emailBatches = store.get('emailBatches') ?? [];

  try {
    await database.importAll(
      {
        schemaVersion: 1,
        suppliers,
        rawMaterials,
        components,
        products,
        stockSnapshots,
        productionPlans,
        shortageReports,
        emailBatches,
        settings: database.getSettings(),
      },
      'merge',
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }

  store.set('migration_done', true);
  return {
    ok: true,
    counts: {
      suppliers: suppliers.length,
      rawMaterials: rawMaterials.length,
      components: components.length,
      products: products.length,
      stockSnapshots: stockSnapshots.length,
      productionPlans: productionPlans.length,
      shortageReports: shortageReports.length,
      emailBatches: emailBatches.length,
    },
  };
}

const LEGACY_KEYS = [
  'suppliers',
  'rawMaterials',
  'components',
  'products',
  'stockSnapshots',
  'productionPlans',
  'shortageReports',
  'emailBatches',
] as const;

/**
 * After a finished migration the pre-Supabase business data still sits in
 * config.json — a stale plain-text copy of suppliers, prices and recipes, and
 * ~300 KB that electron-store re-reads and parses on every settings access.
 * Move it once into a dated file in the backups folder, then drop it from the
 * store. No-op before the migration and once moved. Never throws.
 */
export function archiveMigratedLegacyData(backupsDir: string): void {
  try {
    const store = getLegacyStore();
    if (store.get('migration_done') !== true) return;
    const present = LEGACY_KEYS.filter((k) => store.has(k));
    if (present.length === 0) return;
    const legacy: Record<string, unknown> = {};
    for (const k of present) legacy[k] = store.get(k);
    fs.mkdirSync(backupsDir, { recursive: true });
    const target = path.join(backupsDir, `legacy-local-data-${localDateIso()}.json`);
    fs.writeFileSync(target, JSON.stringify(legacy, null, 2), { encoding: 'utf-8', mode: 0o600 });
    for (const k of present) store.delete(k);
    log.info(`[migration] legacy local data moved to ${target}`);
  } catch (err) {
    log.warn(`[migration] could not archive legacy data: ${err instanceof Error ? err.message : err}`);
  }
}
