import type {
  Supplier,
  RawMaterial,
  PackagingComponent,
  Product,
  StockSnapshot,
  StockRow,
  ProductionPlan,
  AppSettings,
  ImportSummary,
  ShortageReport,
  ShortageReportEntry,
  CostReport,
  EmailBatch,
  MaxProducibleResult,
  Lang,
  StoreSchema,
} from '../shared/types';

export interface ElectronAPI {
  // Suppliers
  listSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | undefined>;
  createSupplier(input: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Promise<Supplier>;
  updateSupplier(id: string, patch: Partial<Supplier>): Promise<Supplier>;
  deleteSupplier(id: string): Promise<{ ok: boolean; blockedBy?: string[] }>;

  // Raw materials
  listRawMaterials(): Promise<RawMaterial[]>;
  getRawMaterial(id: string): Promise<RawMaterial | undefined>;
  createRawMaterial(
    input: Omit<RawMaterial, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<RawMaterial>;
  updateRawMaterial(id: string, patch: Partial<RawMaterial>): Promise<RawMaterial>;
  deleteRawMaterial(id: string): Promise<{ ok: boolean; blockedBy?: string[] }>;

  // Components
  listComponents(): Promise<PackagingComponent[]>;
  getComponent(id: string): Promise<PackagingComponent | undefined>;
  createComponent(
    input: Omit<PackagingComponent, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PackagingComponent>;
  updateComponent(id: string, patch: Partial<PackagingComponent>): Promise<PackagingComponent>;
  deleteComponent(id: string): Promise<{ ok: boolean; blockedBy?: string[] }>;

  // Products
  listProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product>;
  updateProduct(id: string, patch: Partial<Product>): Promise<Product>;
  deleteProduct(id: string): Promise<{ ok: boolean }>;
  duplicateProduct(id: string): Promise<Product>;

  // Stock
  selectStockFiles(): Promise<{ rawPath?: string; componentPath?: string }>;
  importStock(args: { rawPath?: string; componentPath?: string }): Promise<ImportSummary>;
  listStockSnapshots(): Promise<StockSnapshot[]>;
  getCurrentStock(): Promise<{
    raw: StockRow[];
    components: StockRow[];
    rawSnapshot: { id: string; importedAt: string; sourceFile: string } | null;
    componentSnapshot: { id: string; importedAt: string; sourceFile: string } | null;
  }>;
  resolveStockMatch(
    snapshotId: string,
    rowKey: string,
    targetKind: 'raw' | 'component',
    targetId: string,
  ): Promise<{ ok: boolean }>;
  updateStockRow(
    snapshotId: string,
    rowKey: string,
    patch: Partial<StockRow>,
  ): Promise<StockRow | undefined>;
  deleteStockRow(snapshotId: string, rowKey: string): Promise<{ ok: boolean }>;
  deleteStockSnapshot(snapshotId: string): Promise<{ ok: boolean }>;
  deleteStockSnapshotsByKind(
    kind: 'raw' | 'component',
  ): Promise<{ ok: boolean; deleted: number }>;

  // Plans
  listPlans(): Promise<ProductionPlan[]>;
  getPlan(id: string): Promise<ProductionPlan | undefined>;
  createPlan(
    input: Omit<ProductionPlan, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProductionPlan>;
  updatePlan(id: string, patch: Partial<ProductionPlan>): Promise<ProductionPlan>;
  deletePlan(id: string): Promise<{ ok: boolean }>;
  duplicatePlan(id: string): Promise<ProductionPlan>;
  computeShortages(planId: string): Promise<ShortageReport>;
  computeCost(planId: string): Promise<CostReport>;

  // Shortage report history
  listShortageReports(): Promise<ShortageReportEntry[]>;
  getShortageReport(id: string): Promise<ShortageReportEntry | undefined>;
  deleteShortageReport(id: string): Promise<{ ok: boolean }>;
  updateShortageReport(
    id: string,
    patch: { reportName?: string },
  ): Promise<ShortageReportEntry | undefined>;

  // Email batches (RFQ history)
  generateEmails(
    reportId: string,
    opts: { language: Lang; useAI: boolean; sendToAllAlternatives?: boolean },
  ): Promise<EmailBatch>;
  listEmailBatches(): Promise<EmailBatch[]>;
  getEmailBatch(id: string): Promise<EmailBatch | undefined>;
  deleteEmailBatch(id: string): Promise<{ ok: boolean }>;
  updateBatchEmail(
    batchId: string,
    emailId: string,
    patch: { body?: string; subject?: string },
  ): Promise<EmailBatch | undefined>;
  markEmailSent(
    batchId: string,
    emailId: string,
    sentAt: string | null,
  ): Promise<EmailBatch | undefined>;
  regenerateBatchEmail(
    batchId: string,
    emailId: string,
    opts: { language: Lang; useAI: boolean },
  ): Promise<EmailBatch>;

  // Reverse
  maxProducible(productId: string): Promise<MaxProducibleResult>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;

  // Backup
  exportBackup(): Promise<{ ok: boolean; path?: string }>;
  importBackup(mode: 'merge' | 'replace'): Promise<{ ok: boolean; applied?: number }>;

  // Generic file save/open (per-view CSV/JSON)
  saveTextFile(args: {
    defaultName: string;
    content: string;
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ ok: boolean; path?: string }>;
  openTextFile(args?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<{ ok: boolean; path?: string; content?: string }>;

  // LLM
  isAiAvailable(): Promise<{ available: boolean; model?: string }>;
  rewriteEmailWithAI(
    draftBody: string,
    language: Lang,
    ctx?: { supplierName?: string },
  ): Promise<string>;
  suggestMatchWithAI(
    sourceName: string,
    candidates: { id: string; name: string }[],
  ): Promise<{ id: string; confidence: number } | null>;

  // Demo / data
  seedDemo(): Promise<{
    suppliers: number;
    rawMaterials: number;
    components: number;
    products: number;
    plans: number;
    stockSnapshots: number;
  }>;
  wipeData(): Promise<{ ok: boolean }>;

  // App
  getAppVersion(): Promise<string>;
  openExternal(url: string): Promise<void>;
  checkForUpdates(): Promise<{ available: boolean; info?: any; message?: string; error?: string }>;
  downloadUpdate(): Promise<{ ok: boolean; openedRelease?: boolean; error?: string }>;

  onUpdateAvailable(cb: (info: any) => void): void;
  onUpdateDownloaded(cb: (info: any) => void): void;
  onUpdateError(cb: (msg: string) => void): void;
  onDownloadProgress(cb: (p: any) => void): void;

  // Zoom
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;

  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export type { StoreSchema };
