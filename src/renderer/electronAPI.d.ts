import type {
  Supplier,
  RawMaterial,
  PackagingComponent,
  Product,
  StockSnapshot,
  StockRow,
  StockConflict,
  StockConflictResolution,
  StockSyncResult,
  ProductionPlan,
  AppSettings,
  ImportSummary,
  RawMaterialsImportMode,
  RawMaterialsImportSummary,
  ComponentsImportSummary,
  MagazynStockAnalysis,
  MagazynStockDecision,
  MagazynStockCommitResult,
  MagazynStockUnmatched,
  RawStockAnalysis,
  RawStockDecision,
  RawStockCommitResult,
  RawStockUnmatched,
  ExpiredBatchRef,
  RecipeImportAnalysis,
  RecipeImportMode,
  RecipeImportResolutions,
  RecipeImportSummary,
  ShortageReport,
  ShortageReportEntry,
  CostReport,
  EmailBatch,
  MaxProducibleResult,
  Lang,
  StoreSchema,
  CatalogAlias,
  MatchSuggestion,
  Order,
  WorkflowTemplate,
  TaskInstance,
  TaskTemplate,
} from '../shared/types';

export interface ElectronAPI {
  // Suppliers
  listSuppliers(): Promise<Supplier[]>;
  getSupplier(id: string): Promise<Supplier | undefined>;
  createSupplier(input: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Promise<Supplier>;
  updateSupplier(id: string, patch: Partial<Supplier>): Promise<Supplier>;
  deleteSupplier(id: string): Promise<{ ok: boolean; blockedBy?: string[] }>;
  duplicateSupplier(id: string): Promise<Supplier>;

  // Raw materials
  listRawMaterials(): Promise<RawMaterial[]>;
  getRawMaterial(id: string): Promise<RawMaterial | undefined>;
  createRawMaterial(
    input: Omit<RawMaterial, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<RawMaterial>;
  updateRawMaterial(id: string, patch: Partial<RawMaterial>): Promise<RawMaterial>;
  deleteRawMaterial(id: string): Promise<{ ok: boolean; blockedBy?: string[] }>;
  duplicateRawMaterial(id: string): Promise<RawMaterial>;
  importRawMaterialsXlsx(mode: RawMaterialsImportMode): Promise<{
    ok: boolean;
    summary?: RawMaterialsImportSummary;
    error?: string;
  }>;
  analyzeRawStock(): Promise<{ ok: boolean; analysis?: RawStockAnalysis; error?: string }>;
  commitRawStock(args: {
    sourceFile: string;
    analysis: RawStockAnalysis;
    decisions: RawStockDecision[];
    createItems?: RawStockUnmatched[];
  }): Promise<RawStockCommitResult>;

  // Components
  listComponents(): Promise<PackagingComponent[]>;
  getComponent(id: string): Promise<PackagingComponent | undefined>;
  createComponent(
    input: Omit<PackagingComponent, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<PackagingComponent>;
  updateComponent(id: string, patch: Partial<PackagingComponent>): Promise<PackagingComponent>;
  deleteComponent(id: string): Promise<{ ok: boolean; blockedBy?: string[] }>;
  duplicateComponent(id: string): Promise<PackagingComponent>;
  importComponentsXlsx(mode: RawMaterialsImportMode): Promise<{
    ok: boolean;
    summary?: ComponentsImportSummary;
    error?: string;
  }>;
  analyzeMagazynStock(): Promise<{
    ok: boolean;
    analysis?: MagazynStockAnalysis;
    error?: string;
  }>;
  commitMagazynStock(args: {
    sourceFile: string;
    decisions: MagazynStockDecision[];
    createItems?: MagazynStockUnmatched[];
  }): Promise<MagazynStockCommitResult>;

  // Products
  listProducts(): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(input: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Promise<Product>;
  updateProduct(id: string, patch: Partial<Product>): Promise<Product>;
  deleteProduct(id: string): Promise<{ ok: boolean }>;
  duplicateProduct(id: string): Promise<Product>;
  analyzeRecipesXlsx(
    mode: RecipeImportMode,
  ): Promise<{ ok: boolean; analysis?: RecipeImportAnalysis; error?: string }>;
  commitRecipesXlsx(
    filePath: string,
    mode: RecipeImportMode,
    resolutions: RecipeImportResolutions,
  ): Promise<{ ok: boolean; summary?: RecipeImportSummary; error?: string }>;
  exportRecipesXlsx(): Promise<{ ok: boolean; path?: string; error?: string }>;

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
  resolveStockConflicts(
    resolutions: StockConflictResolution[],
  ): Promise<{ ok: boolean }>;
  syncStockCatalog(): Promise<StockSyncResult>;
  setManualStock(
    kind: 'raw' | 'component',
    itemId: string,
    qty: number,
  ): Promise<RawMaterial | PackagingComponent>;
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
  suggestStockMatches(
    kind: 'raw' | 'component',
    source: { name: string; mpFirmaSymbol?: string },
    limit?: number,
  ): Promise<MatchSuggestion[]>;
  importStockFromBsx(): Promise<ImportSummary>;
  loadBsxPrices(snapshotIds: { raw?: string; component?: string }): Promise<
    { ok: true; raw: number; component: number } | { ok: false; error: string }
  >;

  // BSX integration
  testBsxConnection(): Promise<{ ok: true } | { ok: false; error: string }>;
  setBsxPassword(password: string): Promise<{ ok: boolean }>;
  clearBsxPassword(): Promise<{ ok: boolean }>;
  listBsxWarehouses(): Promise<
    | { ok: true; warehouses: { id: number; title: string; symbol?: string; ownerName?: string }[] }
    | { ok: false; error: string }
  >;

  // Catalog aliases (smart fuzzy mappings)
  listRawMaterialAliases(): Promise<CatalogAlias[]>;
  addRawMaterialAlias(targetId: string, alias: string): Promise<CatalogAlias>;
  deleteRawMaterialAlias(id: string): Promise<{ ok: boolean }>;
  listComponentAliases(): Promise<CatalogAlias[]>;
  addComponentAlias(targetId: string, alias: string): Promise<CatalogAlias>;
  deleteComponentAlias(id: string): Promise<{ ok: boolean }>;

  // Plans
  listPlans(): Promise<ProductionPlan[]>;
  getPlan(id: string): Promise<ProductionPlan | undefined>;
  createPlan(
    input: Omit<ProductionPlan, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProductionPlan>;
  updatePlan(id: string, patch: Partial<ProductionPlan>): Promise<ProductionPlan>;
  deletePlan(id: string): Promise<{ ok: boolean }>;
  duplicatePlan(id: string): Promise<ProductionPlan>;
  computeShortages(
    planId: string,
    orderId?: string,
    includeExpiredBatchIds?: string[],
  ): Promise<ShortageReport>;
  previewExpiredForPlan(planId: string): Promise<ExpiredBatchRef[]>;
  computeCost(planId: string): Promise<CostReport>;

  // Shortage report history
  listShortageReports(): Promise<ShortageReportEntry[]>;
  getShortageReport(id: string): Promise<ShortageReportEntry | undefined>;
  deleteShortageReport(id: string): Promise<{ ok: boolean }>;
  updateShortageReport(
    id: string,
    patch: { reportName?: string; orderId?: string | null; archived?: boolean },
  ): Promise<ShortageReportEntry | undefined>;
  setReportSupplierReceived(
    reportId: string,
    supplierId: string,
    receivedAt: string | null,
  ): Promise<ShortageReportEntry | undefined>;

  // Email batches (RFQ history)
  generateEmails(
    reportId: string,
    opts: { language: Lang; useAI: boolean; sendToAllAlternatives?: boolean },
  ): Promise<EmailBatch>;
  listEmailBatches(): Promise<EmailBatch[]>;
  getEmailBatch(id: string): Promise<EmailBatch | undefined>;
  deleteEmailBatch(id: string): Promise<{ ok: boolean }>;
  updateEmailBatch(
    id: string,
    patch: { batchName?: string; orderId?: string | null },
  ): Promise<EmailBatch | undefined>;
  updateBatchEmail(
    batchId: string,
    emailId: string,
    patch: {
      body?: string;
      subject?: string;
      supplierId?: string;
      supplierName?: string;
      to?: string;
    },
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

  // Orders
  listOrders(): Promise<Order[]>;
  getOrder(id: string): Promise<Order | undefined>;
  createOrder(input: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Promise<Order>;
  updateOrder(id: string, patch: Partial<Order>): Promise<Order>;
  deleteOrder(id: string): Promise<{ ok: boolean }>;
  duplicateOrder(id: string): Promise<Order>;
  attachWorkflowToOrder(orderId: string, templateId: string): Promise<Order>;
  detachWorkflowFromOrder(orderId: string): Promise<Order>;
  updateOrderTask(
    orderId: string,
    taskId: string,
    patch: Partial<TaskInstance>,
  ): Promise<Order>;
  addOrderTask(
    orderId: string,
    input: Omit<TaskInstance, 'id' | 'startDate' | 'endDate' | 'status'> & {
      durationDays: number;
      note?: string;
    },
    insertAtIndex?: number,
  ): Promise<Order>;
  deleteOrderTask(orderId: string, taskId: string): Promise<Order>;
  reorderOrderTasks(orderId: string, fromIndex: number, toIndex: number): Promise<Order>;

  // Workflow templates
  listWorkflowTemplates(): Promise<WorkflowTemplate[]>;
  getWorkflowTemplate(id: string): Promise<WorkflowTemplate | undefined>;
  createWorkflowTemplate(
    input: Omit<WorkflowTemplate, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<WorkflowTemplate>;
  updateWorkflowTemplate(
    id: string,
    patch: Partial<WorkflowTemplate>,
  ): Promise<WorkflowTemplate>;
  deleteWorkflowTemplate(id: string): Promise<{ ok: boolean }>;
  duplicateWorkflowTemplate(id: string): Promise<WorkflowTemplate>;

  // Reverse
  maxProducible(
    productId: string,
    includeExpiredBatchIds?: string[],
  ): Promise<MaxProducibleResult>;

  // Settings
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  /**
   * Write an explicit overage % onto every raw material / component, or pass
   * `null` to clear it so every item inherits the default. Returns count touched.
   */
  setOveragePctForAll(kind: 'raw' | 'component', pct: number | null): Promise<number>;

  // Backup
  exportBackup(): Promise<{ ok: boolean; path?: string }>;
  importBackup(
    mode: 'merge' | 'replace',
  ): Promise<{ ok: boolean; applied?: number; error?: string }>;
  backupGetStatus(): Promise<{
    folder: string;
    lastAutoBackup: string | null;
    autoBackupCount: number;
    offsiteConfigured: boolean;
  }>;
  backupOpenFolder(): Promise<{ ok: boolean }>;

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
  downloadUpdate(): Promise<{ ok: boolean; inApp?: boolean; openedRelease?: boolean; error?: string }>;

  onUpdateAvailable(cb: (info: any) => void): void;
  onUpdateDownloaded(cb: (info: any) => void): void;
  onUpdateError(cb: (msg: string) => void): void;
  onDownloadProgress(cb: (p: any) => void): void;
  onBackupCreated(
    cb: (info: {
      filePath: string;
      date: string;
      upload: 'uploaded' | 'failed' | 'disabled';
      trigger: 'startup' | 'quit';
    }) => void,
  ): () => void;
  onBackupStarted(cb: (info: { trigger: 'startup' | 'quit' }) => void): () => void;
  onBackupFailed(cb: (info: { trigger: 'startup' | 'quit' }) => void): () => void;

  // Zoom
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;

  // Auth (Supabase)
  authSignIn(
    email: string,
    password: string,
  ): Promise<
    { ok: true; session: { email: string; userId: string } } | { ok: false; error: string }
  >;
  authSignOut(): Promise<void>;
  authGetSession(): Promise<{ email: string; userId: string } | null>;

  // One-time local→cloud migration
  migrationGetStatus(): Promise<{
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
  }>;
  migrationRun(): Promise<
    | { ok: true; counts: {
        suppliers: number;
        rawMaterials: number;
        components: number;
        products: number;
        stockSnapshots: number;
        productionPlans: number;
        shortageReports: number;
        emailBatches: number;
      } }
    | { ok: false; error: string }
  >;

  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export type { StoreSchema };
