export type UUID = string;
export type ISODate = string;
export type Lang = 'pl' | 'en';

export type Unit = 'g' | 'kg' | 'ml' | 'l';

export interface Supplier {
  id: UUID;
  name: string;
  email: string;
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
  createdAt: ISODate;
  updatedAt: ISODate;
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
  // For secondary (shipping) packaging: the total capacity of 1 unit of this
  // component, expressed in `capacityUnit`. Examples: carton holds 50 slots
  // ('units'), tape roll has 50 m ('m'), barrel holds 200 l ('l'), bag holds
  // 25 kg ('kg'). Ignored for primary components.
  capacity?: number;
  capacityUnit?: PackingCapacityUnit;
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

export interface StockSnapshot {
  id: UUID;
  importedAt: ISODate;
  sourceFile: string;
  kind: StockKind;
  rows: StockRow[];
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

export interface AppSettings {
  language: Lang;
  darkMode: boolean;
  wasteFactor: number;
  defaultCurrency: string;
  lastImportDir?: string;
  defaultEmailLanguage: Lang;
  llm: {
    useByDefault: boolean;
  };
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
}

export interface ShortageReportEntry {
  id: UUID;
  planId: UUID;
  planName: string;
  reportName: string;
  computedAt: ISODate;
  report: ShortageReport;
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
  reportComputedAt: ISODate;
  generatedAt: ISODate;
  language: Lang;
  emails: RFQEmailRecord[];
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
  }[];
}
