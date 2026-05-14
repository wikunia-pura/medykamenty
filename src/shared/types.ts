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
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface RecipeIngredient {
  rawMaterialId: UUID;
  percentage: number;
}

export interface RecipePackaging {
  componentId: UUID;
  qtyPerUnit: number;
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
  packaging: RecipePackaging[];
  notes?: string;
  archived: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
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
  // Names of components that defaulted to qtyPerUnit=1 but represent secondary
  // packaging (outer cartons, tape, barrels, bags). The user needs to revise
  // these manually because qty-per-unit is a ratio for those, not 1:1.
  qtyReviewNeeded: string[];
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
