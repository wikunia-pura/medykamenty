export type UUID = string;
export type ISODate = string;
export type Lang = 'pl' | 'en';

export type Unit = 'g' | 'kg' | 'ml' | 'l';

// What the supplier provides. Drives which picker shows them (raw materials
// vs. packaging components) and which RFQ email template is used. Optional
// for legacy suppliers without a category — those still appear in both
// pickers until the user assigns a type.
export type SupplierType = 'raw' | 'component';

export interface Supplier {
  id: UUID;
  name: string;
  email: string;
  type?: SupplierType;
  phone?: string;
  contactPerson?: string;
  paymentTerms?: string;
  notes?: string;
  preferredEmailLanguage?: Lang;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface RawMaterial {
  id: UUID;
  name: string;
  mpFirmaSymbol?: string;
  unit: Unit;
  supplierIds: UUID[];
  preferredSupplierId?: UUID;
  factorySupplied: boolean;
  moq?: number;
  leadTimeDays?: number;
  shelfLifeMonths?: number;
  lastPurchasePriceNet?: number;
  currency?: string;
  notes?: string;
  // Per-item overage ("naddatek") as a percentage on top of the bare
  // requirement (e.g. 5 == +5%). When undefined the item inherits the
  // type-level default (AppSettings.defaultOveragePctRaw). Never touched by
  // imports — see services/overage helpers in src/shared/overage.ts.
  overagePct?: number;
  // Current warehouse stock, expressed in this item's `unit` (g/kg/ml/l).
  // Maintained by stock imports and manual edits — see `stockSource`.
  // When `stockBatches` is present this equals the sum of all batch quantities
  // (expired included) — the calculators use only the non-expired subset.
  stockQty?: number;
  stockUpdatedAt?: ISODate; // when stock was last set (import or manual)
  stockSource?: StockSource;
  stockSourceFile?: string; // display label: "MP firma" / "manual.xlsx" / "BSX idstock=..."
  // Stock split into batches/lots by expiry date, from the "Magazyn" stock
  // import ("Stan surowców"). A material's stock can span several rows in the
  // file, each with its own expiry — those become batches here. Absent for
  // materials whose stock was set manually or by a batch-less import.
  stockBatches?: StockBatch[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

// One lot of a raw material's stock with its own expiry. `expiryDate` is the
// original "Data ważności" (column F); `retestExpiryDate` is the extended
// expiry after a physico-chemical retest (column H) and, when present, is the
// *effective* expiry used in calculations — the original is kept only for
// display. See src/shared/expiry.ts for the derived helpers.
export interface StockBatch {
  id: UUID;
  qty: number; // in the material's unit
  productionDate?: ISODate; // column E "Data produkcji"
  expiryDate?: ISODate; // column F "Data ważności" (original)
  microTestDate?: ISODate; // column G "Badania mikrobiologiczne"
  retestExpiryDate?: ISODate; // column H "Data ważności po reteście" — effective when set
  note?: string; // column I "Uwagi" (per-batch)
}

// Primary packaging belongs to the "Komponenty" section in the recipe Excel:
//   tube, bottle, jar, label, cap, pump, pipette, box (kartonik produktowy), leaflet.
// Secondary packaging belongs to "Pozostałe komponenty":
//   outer_carton, tape, barrel, bag, confection (Konfekcja), other.
export type ComponentType =
  | 'tube'
  | 'bottle'
  | 'jar'
  | 'label'
  | 'cap'
  | 'pump'
  | 'pipette'
  | 'box'
  | 'leaflet'
  | 'outer_carton'
  | 'tape'
  | 'barrel'
  | 'bag'
  | 'confection'
  | 'other';

export const SECONDARY_COMPONENT_TYPES: readonly ComponentType[] = [
  'outer_carton',
  'tape',
  'barrel',
  'bag',
  'confection',
] as const;

export function isSecondaryComponent(type: ComponentType): boolean {
  return (SECONDARY_COMPONENT_TYPES as readonly string[]).includes(type);
}

export interface PackagingComponent {
  id: UUID;
  name: string;
  type: ComponentType;
  mpFirmaSymbol?: string;
  supplierIds: UUID[];
  preferredSupplierId?: UUID;
  moq?: number;
  leadTimeDays?: number;
  lastPurchasePriceNet?: number;
  currency?: string;
  notes?: string;
  // Per-item overage ("naddatek") as a percentage on top of the bare
  // requirement (e.g. 5 == +5%). When undefined the component inherits the
  // type-level default (AppSettings.defaultOveragePctComponent). Never touched
  // by imports — see src/shared/overage.ts.
  overagePct?: number;
  // For secondary (shipping) packaging: the total capacity of 1 unit of this
  // component, expressed in `capacityUnit`. Examples: carton holds 50 slots
  // ('units'), tape roll has 50 m ('m'), barrel holds 200 l ('l'), bag holds
  // 25 kg ('kg'). Ignored for primary components.
  capacity?: number;
  capacityUnit?: PackingCapacityUnit;
  // Current warehouse stock, expressed in units (pcs). Maintained by stock
  // imports and manual edits — see `stockSource`.
  stockQty?: number;
  stockUpdatedAt?: ISODate; // when stock was last set (import or manual)
  stockSource?: StockSource;
  stockSourceFile?: string; // display label: import source or "manual"
  // Free-text warehouse note attached to the stock (column "Uwagi" from the
  // "Magazyn" stock import). Shown as an info tooltip next to the stock value.
  stockNote?: string;
  // Cascade dependencies: "1 unit of this component consumes N units of
  // <componentId>'s capacity-unit". Examples: 1 carton uses 10 m of tape →
  // {componentId: tapeId, consumption: 10}; 1 barrel uses 1 bag →
  // {componentId: bagId, consumption: 1}. No cycle support — validated at
  // save time. Ignored for primary components.
  dependencies?: ComponentDependency[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ComponentDependency {
  componentId: UUID;
  consumption: number;
}

export interface RecipeIngredient {
  rawMaterialId: UUID;
  percentage: number;
}

export interface RecipePackaging {
  componentId: UUID;
  qtyPerUnit: number;
}

// "Schemat opakowania zbiorczego" — replaces the "Pozostałe komponenty" section
// from the recipe Excel. A flat list of tiers; each tier expresses how much
// of a given shared-packaging component one finished product consumes. The
// component itself owns the *total* capacity (e.g. carton has 50 slots); the
// tier owns the *per-product consumption* (e.g. this product takes 2 slots
// → fits 25 per carton). Direct per-product cost is then
// `comp.price × tier.consumption / comp.capacity`. Cross-packaging cascades
// (carton consumes tape) live on the component via `dependencies`.
export type PackingCapacityUnit = 'units' | 'kg' | 'l' | 'm';

// Whether the tier is consumed per finished product unit or per kg / l of
// bulk mass. Cartons / labels / tape rolls bind to finished products; barrels
// and (sometimes) bags bind to the bulk batch — they're consumed regardless
// of how many of those kg eventually become finished units, and they're also
// consumed when a plan declares bulk-mass-only production (no finished units).
export type PackingTierScope = 'per_unit' | 'per_bulk_mass';

export interface PackingTier {
  componentId: UUID;
  // Amount of the referenced component's capacity-unit consumed per the
  // scope unit (1 finished product OR 1 kg/l of bulk mass).
  //   scope=per_unit + 'units'/'m': default 1 (one slot/meter per product),
  //     manual override possible
  //   scope=per_unit + 'kg'/'l': auto-derived per-product mass/volume
  //     unless consumptionOverride is set
  //   scope=per_bulk_mass + 'kg'/'l': default 1 (1 kg/l of bulk consumes 1
  //     unit of bag/barrel capacity)
  consumption: number;
  // When true, the calculator uses `consumption` verbatim. When false (or
  // missing) and the scope+unit combination has an auto-derivation rule,
  // the calculator auto-derives instead of trusting a stored value.
  consumptionOverride?: boolean;
  // Defaults to 'per_unit' when missing. 'per_bulk_mass' only makes sense
  // for components with 'kg' or 'l' capacityUnit.
  scope?: PackingTierScope;
  // Free-form. Migration of legacy data sets this to flag tiers whose
  // consumption is a placeholder and needs user review.
  note?: string;
}

export interface PackingScheme {
  tiers: PackingTier[];
}

export interface Product {
  id: UUID;
  name: string;
  sku?: string;
  capacityMl: number;
  densityGPerMl: number;
  conversionLaborCost?: number;
  // MOQ as full retail units of this product (separate from raw-material MOQ).
  // Imported from "MOQ [szt.]" in the recipe Excel.
  moqUnits?: number;
  // Mass (kg) of bulk to set aside for sample sachets. Sourced from
  // "Masa na saszetki [kg]" in the recipe Excel.
  sachetMassKg?: number;
  // Number of sachets that the `sachetMassKg` produces (varies per product —
  // e.g. 22 kg → 10 000 sachets). User-supplied, not present in the Excel.
  sachetsCount?: number;
  ingredients: RecipeIngredient[];
  // Only primary packaging (1:1 per unit) lives here — tube, label, leaflet…
  // Shared / shipping packaging lives in `packingScheme`.
  packaging: RecipePackaging[];
  packingScheme?: PackingScheme;
  notes?: string;
  archived: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// Pure helper used to migrate legacy products: existing data may have secondary
// components (outer_carton, tape, …) sitting in `packaging[]` with
// `qtyPerUnit = 1` (placeholder from earlier importer). Move them to
// `packingScheme.tiers[]` with a placeholder consumption so the user reviews
// the value (the capacity itself now lives on the component).
// Idempotent: if scheme already contains entries for those components or
// packaging[] has no secondaries, the input is returned unchanged.
export function migrateLegacySecondaryPackaging(
  product: Product,
  componentTypeById: Map<UUID, ComponentType>,
): Product {
  const primary: RecipePackaging[] = [];
  const movedTiers: PackingTier[] = [];
  for (const pkg of product.packaging ?? []) {
    const t = componentTypeById.get(pkg.componentId);
    if (t && isSecondaryComponent(t)) {
      movedTiers.push({
        componentId: pkg.componentId,
        // 1 of the component's capacity-unit consumed per product — sensible
        // default (e.g. takes 1 slot in carton). User reviews via the note.
        consumption: 1,
        note: 'MIGRACJA — sprawdź zużycie',
      });
    } else {
      primary.push(pkg);
    }
  }
  if (movedTiers.length === 0) return product;
  const existingScheme = product.packingScheme ?? { tiers: [] };
  // Don't duplicate a tier for a component that's already in the scheme.
  const existingCompIds = new Set(existingScheme.tiers.map((t) => t.componentId));
  const dedupedNew = movedTiers.filter((t) => !existingCompIds.has(t.componentId));
  if (dedupedNew.length === 0 && primary.length === (product.packaging?.length ?? 0)) {
    return product;
  }
  return {
    ...product,
    packaging: primary,
    packingScheme: { tiers: [...existingScheme.tiers, ...dedupedNew] },
  };
}

// In-place normalization of products/components whose JSONB still has the
// previous schema (capacity/capacityUnit on tier, defaultCapacity on
// component). Run on every read so consumers always see the current shape.
// Idempotent; pure with respect to inputs.
export function normalizeProductSchema(product: Product): Product {
  let changed = false;
  let tiers = product.packingScheme?.tiers;
  if (tiers && tiers.length > 0) {
    const next: PackingTier[] = [];
    for (const tier of tiers) {
      const legacy = tier as PackingTier & {
        capacity?: number;
        capacityUnit?: PackingCapacityUnit;
      };
      if (legacy.consumption === undefined && legacy.capacity !== undefined) {
        // Old shape: tier carried "capacity = N per product" (e.g. 50 = "50
        // products fit in 1 carton"). New shape stores 1 / oldCapacity as
        // consumption on the tier and pushes the total capacity to the
        // component itself. Simpler default: consumption = 1, leaving the
        // total capacity on the component for the user to set. Flag for
        // review so they notice if the legacy value was meaningful.
        next.push({
          componentId: legacy.componentId,
          consumption: 1,
          note: legacy.note ?? 'MIGRACJA — sprawdź zużycie',
        });
        changed = true;
      } else {
        next.push(tier);
      }
    }
    tiers = next;
  }
  if (!changed) return product;
  return { ...product, packingScheme: tiers ? { tiers } : undefined };
}

export function normalizeComponentSchema(component: PackagingComponent): PackagingComponent {
  const legacy = component as PackagingComponent & {
    defaultCapacity?: number;
    defaultCapacityUnit?: PackingCapacityUnit;
  };
  // Old shape had `defaultCapacity`/`defaultCapacityUnit`; new uses
  // `capacity`/`capacityUnit`. Copy if missing on the new side.
  if (
    component.capacity === undefined &&
    legacy.defaultCapacity !== undefined
  ) {
    return {
      ...component,
      capacity: legacy.defaultCapacity,
      capacityUnit: legacy.defaultCapacityUnit ?? 'units',
    };
  }
  return component;
}

export interface CatalogAlias {
  id: UUID;
  targetId: UUID;
  alias: string;
  createdAt: ISODate;
}

export interface MatchSuggestion {
  id: UUID;
  name: string;
  confidence: number;
}

export interface StockRow {
  rowKey: string;
  mpFirmaId?: string;
  mpFirmaSymbol?: string;
  name: string;
  qty: number;
  warehouse?: string;
  netPrice?: number;
  vatPrice?: number;
  grossPrice?: number;
  currency?: string;
  oNet?: number;
  oVat?: number;
  oGross?: number;
  manufacturerSymbol?: string;
  notes?: string;
  matchedRawMaterialId?: UUID;
  matchedComponentId?: UUID;
  matchConfidence?: number;
  matchAmbiguous?: boolean;
}

export type StockKind = 'raw' | 'component';

// How a catalog item's `stockQty` was last set. 'import' = written by a stock
// import (overwritten silently by later imports); 'manual' = edited by the user
// (protected — later imports that disagree raise a StockConflict instead of
// overwriting).
export type StockSource = 'import' | 'manual';

export interface StockSnapshot {
  id: UUID;
  importedAt: ISODate;
  sourceFile: string;
  kind: StockKind;
  rows: StockRow[];
}

// Raised during reconciliation when an import disagrees with a manually-edited
// catalog stock value. The user resolves each conflict (keep current / take
// import) — see StockConflictResolution.
export interface StockConflict {
  itemId: UUID;
  kind: StockKind;
  name: string;
  currentQty?: number; // manual value currently in the catalog
  currentUpdatedAt?: ISODate;
  importedQty: number; // value aggregated from matched import rows
  importSourceFile?: string;
  unit?: string; // raw materials only — unit label for display
}

export interface StockConflictResolution {
  itemId: UUID;
  kind: StockKind;
  action: 'keep' | 'take';
  importedQty: number;
  importSourceFile?: string; // carried from the conflict so 'take' keeps provenance
}

// ---- "Magazyn" stock import (Components / Bulk packaging catalog) ----
//
// A targeted import of the warehouse spreadsheet's "Stan komponentów" sheet. It
// only touches components that already exist in the catalog (matched by name);
// anything extra in the file is ignored. Column C is the warehouse count,
// column E a free-text note. Two-phase: analyze (parse + match, no writes) →
// user resolves per-item quantity differences → commit.
export interface MagazynStockMatch {
  itemId: UUID;
  name: string; // catalog name
  excelName: string; // name as written in the spreadsheet (may differ slightly)
  currentQty?: number; // current catalog stock
  importedQty: number; // column C
  note?: string; // column E ("Uwagi")
  differs: boolean; // importedQty !== currentQty
}

// A file row with no catalog match — the user decides whether to create it as
// a new component or ignore it (individually or in bulk).
export interface MagazynStockUnmatched {
  name: string;
  qty: number; // column C
  note?: string; // column E
}

export interface MagazynStockAnalysis {
  sourceFile: string; // display label, e.g. "Magazyn.xlsx – Stan komponentów"
  matches: MagazynStockMatch[]; // catalog components found in the file
  unmatched: MagazynStockUnmatched[]; // file rows with no catalog match — decidable
  ambiguousNames: string[]; // file names that matched >1 catalog entry — auto-skipped
}

// One user decision. `note` is applied regardless of `action`; `action` only
// governs whether column C overwrites the catalog stock (and stamps the date).
export interface MagazynStockDecision {
  itemId: UUID;
  action: 'keep' | 'take';
  importedQty: number;
  note?: string;
}

export interface MagazynStockCommitResult {
  stockUpdated: number; // items whose stock was overwritten from Excel
  notesUpdated: number; // items whose note was set/changed from Excel
  kept: number; // differing items the user chose to leave as-is
  created: number; // unmatched rows the user chose to create as new components
}

// ---- "Magazyn" raw-material stock import ("Stan surowców") ----
//
// Like the component stock import, but a material's stock is split into
// batches by expiry (one file row per batch). Column C is the batch quantity,
// column D the material total; when the batch quantities don't sum to the
// total, the row is a "sum mismatch" the user resolves (take from import /
// reject). Only existing catalog materials (matched by name) are touched.
export interface RawStockBatchRow {
  qty: number; // column C
  productionDate?: ISODate; // column E
  expiryDate?: ISODate; // column F
  microTestDate?: ISODate; // column G
  retestExpiryDate?: ISODate; // column H
  note?: string; // column I
}

export interface RawStockMatch {
  itemId: UUID;
  name: string; // catalog name
  excelName: string; // name as written in the file
  unit: Unit;
  currentQty?: number; // current catalog stock
  batches: RawStockBatchRow[]; // parsed batches (column C rows)
  batchSum: number; // Σ column C across the batches
  reportedTotal?: number; // column D (the file's own total)
  sumMismatch: boolean; // |batchSum − reportedTotal| > ε
}

// A file material (one or more rows grouped by name) with no catalog match —
// the user decides whether to create it as a new raw material or ignore it.
export interface RawStockUnmatched {
  name: string;
  unit: Unit; // assumed unit for a created material (defaults to kg)
  batches: RawStockBatchRow[];
  batchSum: number;
  reportedTotal?: number;
}

export interface RawStockAnalysis {
  sourceFile: string;
  matches: RawStockMatch[];
  unmatched: RawStockUnmatched[]; // file materials with no catalog match — decidable
  ambiguousNames: string[]; // file names matching >1 catalog entry — auto-skipped
}

// One decision: `action: 'take'` imports the batches (stock ← batchSum);
// 'reject' leaves the catalog material untouched. Only mismatched materials
// need an explicit decision; matched-and-consistent ones import silently.
export interface RawStockDecision {
  itemId: UUID;
  action: 'take' | 'reject';
}

export interface RawStockCommitResult {
  imported: number; // materials whose batches/stock were written
  rejected: number; // mismatched materials the user rejected
  created: number; // unmatched materials the user chose to create
}

// A single expired stock batch surfaced by a calculation so the user can
// decide, for that run, whether to count it as available. `included` reflects
// the decision passed into the compute call (default false = excluded).
export interface ExpiredBatchRef {
  rawMaterialId: UUID;
  rawMaterialName: string;
  batchId: UUID;
  qty: number; // in the material's unit
  unit: Unit;
  originalExpiry?: ISODate; // column F
  effectiveExpiry?: ISODate; // retest (H) ?? original (F)
  note?: string;
  included: boolean;
}

export interface ProductionPlanItem {
  productId: UUID;
  qtyUnits: number;
}

export interface BulkMassItem {
  productId: UUID;
  massKg: number;
}

export type PlanStatus = 'draft' | 'computed' | 'archived';

export interface ProductionPlan {
  id: UUID;
  name: string;
  createdAt: ISODate;
  updatedAt: ISODate;
  items: ProductionPlanItem[];
  bulkMass: BulkMassItem[];
  status: PlanStatus;
  computedAt?: ISODate;
  actualProduced?: ProductionPlanItem[];
}

export interface BsxIntegrationSettings {
  cloudKey?: string;
  username?: string;
  rawIdstock?: number;
  componentIdstock?: number;
  // Set to true when a password has been stored via safeStorage in the main
  // process. The password itself never crosses the IPC boundary back to the
  // renderer.
  hasPassword?: boolean;
}

export interface AppSettings {
  language: Lang;
  darkMode: boolean;
  // Legacy single global overage multiplier (1.05). Kept only so older stores
  // can be migrated to the per-type defaults below; no longer read by
  // calculations. See database.getSettings().
  wasteFactor: number;
  // Type-level default overage percentages ("naddatek"), applied to items that
  // have no explicit overagePct of their own. 5 == +5%.
  defaultOveragePctRaw: number;
  defaultOveragePctComponent: number;
  defaultCurrency: string;
  lastImportDir?: string;
  defaultEmailLanguage: Lang;
  llm: {
    useByDefault: boolean;
  };
  bsx?: BsxIntegrationSettings;
}

export interface StoreSchema {
  schemaVersion: number;
  suppliers: Supplier[];
  rawMaterials: RawMaterial[];
  components: PackagingComponent[];
  products: Product[];
  stockSnapshots: StockSnapshot[];
  productionPlans: ProductionPlan[];
  shortageReports?: ShortageReportEntry[];
  emailBatches?: EmailBatch[];
  orders?: Order[];
  workflowTemplates?: WorkflowTemplate[];
  settings: AppSettings;
}

export interface ImportSummary {
  snapshotIds: UUID[];
  rawCount?: number;
  componentCount?: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
}

// Result of syncing catalog stock from the current snapshots (the manual
// "Synchronizuj stany" action in the stock import view). `applied` counts items
// overwritten silently; `conflicts` are manually-edited items needing a decision.
export interface StockSyncResult {
  applied: number;
  conflicts: StockConflict[];
}

export type RawMaterialsImportMode = 'merge' | 'overwrite';

export interface RawMaterialsImportSummary {
  mode: RawMaterialsImportMode;
  rawCreated: number;
  rawUpdated: number;
  rawSkipped: number;
  rawDeleted: number;
  suppliersCreated: number;
  suppliersUpdated: number;
  warnings: string[];
}

// Components import reuses the raw-materials merge/overwrite semantics. Kept as
// a separate summary shape so the counters read naturally in the UI
// ("komponenty" instead of "surowce").
export interface ComponentsImportSummary {
  mode: RawMaterialsImportMode;
  componentsCreated: number;
  componentsUpdated: number;
  componentsSkipped: number;
  componentsDeleted: number;
  suppliersCreated: number;
  suppliersUpdated: number;
  warnings: string[];
}

export type RecipeImportMode = 'merge' | 'overwrite';

export interface RecipeImportProductResult {
  productName: string;
  // 'created' when no product matched by name, 'updated' for merge/overwrite of
  // an existing one, 'skipped' if the row was unusable (e.g. no name).
  action: 'created' | 'updated' | 'skipped';
  capacityMl?: number;
  ingredientCount: number;
  packagingCount: number;
  schemeTierCount: number;
  // Names of components that landed in `packingScheme.tiers[]` with a
  // placeholder capacity=1 — the user needs to review and set the real
  // capacity (how many products fit in 1 carton, etc.).
  schemeCapacityReviewNeeded: string[];
  warnings: string[];
}

export interface RecipeImportSummary {
  fileName: string;
  mode: RecipeImportMode;
  productsCreated: number;
  productsUpdated: number;
  productsSkipped: number;
  rawMaterialsCreated: number;
  componentsCreated: number;
  perProduct: RecipeImportProductResult[];
  globalWarnings: string[];
}

// Item from a recipe XLSX that didn't resolve to an existing catalog entry.
// The user picks an action per item before the import commits.
export interface RecipeImportUnresolvedItem {
  // Verbatim name from the file (already trimmed).
  name: string;
  // Component section hint when kind==='component'.
  section?: 'primary' | 'secondary';
  // MY/RETTER hint when kind==='raw' — drives factorySupplied on add-new.
  channel?: 'MY' | 'RETTER';
  // Products that reference this item — shown so the user understands the
  // scope of the decision.
  productNames: string[];
  suggestions: MatchSuggestion[];
}

export interface RecipeImportAnalysis {
  fileName: string;
  // Echoed back so commit() doesn't have to re-pick the file.
  filePath: string;
  mode: RecipeImportMode;
  blockCount: number;
  unresolvedRaws: RecipeImportUnresolvedItem[];
  unresolvedComponents: RecipeImportUnresolvedItem[];
}

// User decision for a single unresolved item. Differs from stock import:
// no `use-once` and no `skip` — products are a durable list and require
// every referenced raw / component, so every link has to be permanent
// (alias / rename / new entry).
export type RecipeResolveAction =
  | { type: 'save-alias'; targetId: string }
  | { type: 'rename-existing'; targetId: string }
  | { type: 'add-new' };

export interface RecipeImportResolutionEntry {
  // Match against analysis.unresolvedRaws[i].name verbatim.
  name: string;
  action: RecipeResolveAction;
}

export interface RecipeImportResolutions {
  rawMaterials: RecipeImportResolutionEntry[];
  components: RecipeImportResolutionEntry[];
}

export interface ShortageLine {
  itemId: UUID;
  itemName: string;
  itemKind: 'raw' | 'component';
  unit: Unit | 'pcs';
  required: number;
  available: number;
  shortage: number;
  moq?: number;
  suggestedOrder: number;
  factorySupplied?: boolean;
  preferredSupplierId?: UUID;
}

export interface ShortageGroup {
  supplierId?: UUID;
  supplierName: string;
  supplierEmail?: string;
  rawLines: ShortageLine[];
  componentLines: ShortageLine[];
}

export interface ShortageReport {
  planId: UUID;
  computedAt: ISODate;
  rawLines: ShortageLine[];
  componentLines: ShortageLine[];
  groups: ShortageGroup[];
  warnings: string[];
  // Expired raw-material batches among the plan's materials, with whether each
  // was counted as available for this computation (per-run user decision).
  expiredBatches?: ExpiredBatchRef[];
}

export interface ShortageReportEntry {
  id: UUID;
  planId: UUID;
  planName: string;
  reportName: string;
  computedAt: ISODate;
  report: ShortageReport;
  orderId?: UUID;
  // Per-supplier delivery receipts. supplierId is missing for the
  // "unassigned" group (we use the literal '__none__' there to make the
  // entry addressable). receivedAt is an ISO timestamp.
  supplierReceipts?: { supplierId: string; receivedAt: ISODate }[];
  // Archived reports are hidden from the default list view and cascade
  // their archived flag to any email batches generated from them.
  archived?: boolean;
}

export interface CostBreakdownLine {
  productId: UUID;
  productName: string;
  unitCost: number;
  ingredientsCost: number;
  packagingCost: number;
  laborCost: number;
  missingPriceItems: { itemId: UUID; itemName: string; kind: 'raw' | 'component' }[];
}

export interface CostReport {
  planId: UUID;
  computedAt: ISODate;
  perProduct: CostBreakdownLine[];
  totalPlanCost: number;
}

export interface RFQEmail {
  supplierId?: UUID;
  supplierName: string;
  to: string;
  language: Lang;
  subject: string;
  body: string;
  lines: ShortageLine[];
  refinedByAI?: boolean;
}

export interface RFQEmailRecord extends RFQEmail {
  id: UUID;
  sentAt?: ISODate;
}

export interface EmailBatch {
  id: UUID;
  reportId: UUID;
  planId: UUID;
  planName: string;
  reportName: string;
  // User-editable label for the batch itself (independent of the linked report
  // name). Defaults to the report name when not set, so the user can rename it
  // to something like "RFQ — Plan Q2 — pre-Easter" to distinguish multiple
  // batches generated for the same order.
  batchName: string;
  reportComputedAt: ISODate;
  generatedAt: ISODate;
  language: Lang;
  emails: RFQEmailRecord[];
  orderId?: UUID;
  // Mirrors the archived flag of the linked shortage report so the email
  // batch list can hide it when the source report is archived.
  archived?: boolean;
}

export interface MaxProducibleResult {
  productId: UUID;
  productName: string;
  units: number;
  bottlenecks: {
    itemId: UUID;
    itemName: string;
    kind: 'raw' | 'component';
    available: number;
    needPerUnit: number;
    maxUnits: number;
    // Raw materials with expiry batches: the soonest effective expiry among the
    // batches counted as available, and the quantity excluded because expired
    // (in the material's unit). Absent for batch-less items and components.
    nextExpiry?: ISODate;
    expiredExcludedQty?: number;
  }[];
  // Expired raw-material batches among this product's ingredients, with whether
  // each was counted as available for this computation.
  expiredBatches?: ExpiredBatchRef[];
}

// ============================ Orders / Workflows ============================

// YYYY-MM-DD; tasks are scheduled by calendar day, not by exact timestamp.
export type DateOnly = string;

// 'custom' = user-defined task with arbitrary semantics.
// The other three are wired to existing screens — clicking them navigates and
// auto-sets in_progress; the user marks done themselves.
export type TaskType = 'custom' | 'import_stock' | 'generate_shortage' | 'generate_emails';

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export type OrderStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export interface TaskTemplate {
  id: UUID;
  name: string;
  type: TaskType;
  // Duration in days from the previous task's end (or order startDate for the
  // first task). Used when instantiating a template against an order to
  // compute concrete startDate / endDate.
  durationDays: number;
}

export interface WorkflowTemplate {
  id: UUID;
  name: string;
  tasks: TaskTemplate[];
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface TaskInstance {
  id: UUID;
  name: string;
  type: TaskType;
  status: TaskStatus;
  startDate: DateOnly;
  endDate: DateOnly;
  completedAt?: ISODate;
  // Free-form note attached to a task instance; shown in the progress bar
  // popover/tooltip and the workflow task list.
  note?: string;
}

export interface OrderWorkflow {
  // The template this workflow was instantiated from; cleared if user edits the
  // tasks (instance diverges from template).
  templateId?: UUID;
  // Echoed for display when the template is later renamed/deleted.
  templateName?: string;
  tasks: TaskInstance[];
}

export interface Order {
  id: UUID;
  name: string;
  startDate: DateOnly;
  status: OrderStatus;
  notes?: string;
  workflow?: OrderWorkflow;
  createdAt: ISODate;
  updatedAt: ISODate;
  // Archived orders are hidden from the default list view.
  archived?: boolean;
}
