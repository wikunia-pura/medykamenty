export type UUID = string;
export type ISODate = string;
export type Lang = 'pl' | 'en';

export type Unit = 'g' | 'kg' | 'ml' | 'l';

export interface Supplier {
  id: UUID;
  name: string;
  email: string;
  phone?: string;
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
  | 'other';

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
  ingredients: RecipeIngredient[];
  packaging: RecipePackaging[];
  notes?: string;
  archived: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
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
