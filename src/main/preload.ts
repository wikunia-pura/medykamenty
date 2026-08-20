import { contextBridge, ipcRenderer, IpcRendererEvent, webFrame } from 'electron';

// Channel constants are duplicated here because preload runs in a sandboxed
// environment that cannot resolve the shared module reliably across all
// electron versions. Keep this list in sync with src/shared/ipcChannels.ts.
const CH = {
  SUPPLIERS_LIST: 'suppliers:list',
  SUPPLIERS_GET: 'suppliers:get',
  SUPPLIERS_CREATE: 'suppliers:create',
  SUPPLIERS_UPDATE: 'suppliers:update',
  SUPPLIERS_DELETE: 'suppliers:delete',
  SUPPLIERS_DUPLICATE: 'suppliers:duplicate',

  RAW_LIST: 'rawMaterials:list',
  RAW_GET: 'rawMaterials:get',
  RAW_CREATE: 'rawMaterials:create',
  RAW_UPDATE: 'rawMaterials:update',
  RAW_DELETE: 'rawMaterials:delete',
  RAW_DUPLICATE: 'rawMaterials:duplicate',
  RAW_XLSX_IMPORT: 'rawMaterials:xlsx-import',
  RAW_MAGAZYN_STOCK_ANALYZE: 'rawMaterials:magazyn-stock-analyze',
  RAW_MAGAZYN_STOCK_COMMIT: 'rawMaterials:magazyn-stock-commit',

  COMP_LIST: 'components:list',
  COMP_GET: 'components:get',
  COMP_CREATE: 'components:create',
  COMP_UPDATE: 'components:update',
  COMP_DELETE: 'components:delete',
  COMP_DUPLICATE: 'components:duplicate',
  COMP_XLSX_IMPORT: 'components:xlsx-import',
  COMP_MAGAZYN_STOCK_ANALYZE: 'components:magazyn-stock-analyze',
  COMP_MAGAZYN_STOCK_COMMIT: 'components:magazyn-stock-commit',

  PRODUCTS_LIST: 'products:list',
  PRODUCTS_GET: 'products:get',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_DUPLICATE: 'products:duplicate',
  PRODUCTS_RECIPES_XLSX_ANALYZE: 'products:recipes-xlsx-analyze',
  PRODUCTS_RECIPES_XLSX_COMMIT: 'products:recipes-xlsx-commit',
  PRODUCTS_RECIPES_XLSX_EXPORT: 'products:recipes-xlsx-export',

  STOCK_SELECT_FILES: 'stock:select-files',
  STOCK_IMPORT: 'stock:import',
  STOCK_LIST_SNAPSHOTS: 'stock:list-snapshots',
  STOCK_GET_CURRENT: 'stock:get-current',
  STOCK_RESOLVE_MATCH: 'stock:resolve-match',
  STOCK_RESOLVE_CONFLICTS: 'stock:resolve-conflicts',
  STOCK_SYNC_CATALOG: 'stock:sync-catalog',
  STOCK_SET_MANUAL: 'stock:set-manual',
  STOCK_UPDATE_ROW: 'stock:update-row',
  STOCK_DELETE_ROW: 'stock:delete-row',
  STOCK_DELETE_SNAPSHOT: 'stock:delete-snapshot',
  STOCK_DELETE_KIND: 'stock:delete-kind',
  STOCK_SUGGEST_MATCHES: 'stock:suggest-matches',
  STOCK_IMPORT_BSX: 'stock:import-bsx',
  STOCK_LOAD_BSX_PRICES: 'stock:load-bsx-prices',

  BSX_TEST_CONNECTION: 'bsx:test-connection',
  BSX_SET_PASSWORD: 'bsx:set-password',
  BSX_CLEAR_PASSWORD: 'bsx:clear-password',
  BSX_LIST_WAREHOUSES: 'bsx:list-warehouses',

  RAW_ALIAS_LIST: 'rawMaterials:alias-list',
  RAW_ALIAS_ADD: 'rawMaterials:alias-add',
  RAW_ALIAS_DELETE: 'rawMaterials:alias-delete',
  COMP_ALIAS_LIST: 'components:alias-list',
  COMP_ALIAS_ADD: 'components:alias-add',
  COMP_ALIAS_DELETE: 'components:alias-delete',

  PLAN_LIST: 'plan:list',
  PLAN_GET: 'plan:get',
  PLAN_CREATE: 'plan:create',
  PLAN_UPDATE: 'plan:update',
  PLAN_DELETE: 'plan:delete',
  PLAN_DUPLICATE: 'plan:duplicate',
  PLAN_COMPUTE_SHORTAGES: 'plan:compute-shortages',
  PLAN_PREVIEW_EXPIRED: 'plan:preview-expired',
  PLAN_PREVIEW_DEPENDENCY_SHORTAGES: 'plan:preview-dependency-shortages',
  PLAN_COMPUTE_COST: 'plan:compute-cost',

  SHORTAGE_REPORT_LIST: 'shortageReport:list',
  SHORTAGE_REPORT_GET: 'shortageReport:get',
  SHORTAGE_REPORT_DELETE: 'shortageReport:delete',
  SHORTAGE_REPORT_UPDATE: 'shortageReport:update',
  SHORTAGE_REPORT_SET_SUPPLIER_RECEIVED: 'shortageReport:set-supplier-received',

  EMAIL_BATCH_CREATE: 'emailBatch:create',
  EMAIL_BATCH_LIST: 'emailBatch:list',
  EMAIL_BATCH_GET: 'emailBatch:get',
  EMAIL_BATCH_DELETE: 'emailBatch:delete',
  EMAIL_BATCH_UPDATE: 'emailBatch:update',
  EMAIL_BATCH_UPDATE_EMAIL: 'emailBatch:update-email',
  EMAIL_BATCH_MARK_SENT: 'emailBatch:mark-sent',
  EMAIL_BATCH_REGENERATE_EMAIL: 'emailBatch:regenerate-email',

  ORDERS_LIST: 'orders:list',
  ORDERS_GET: 'orders:get',
  ORDERS_CREATE: 'orders:create',
  ORDERS_UPDATE: 'orders:update',
  ORDERS_DELETE: 'orders:delete',
  ORDERS_DUPLICATE: 'orders:duplicate',
  ORDERS_ATTACH_WORKFLOW: 'orders:attach-workflow',
  ORDERS_DETACH_WORKFLOW: 'orders:detach-workflow',
  ORDERS_UPDATE_TASK: 'orders:update-task',
  ORDERS_ADD_TASK: 'orders:add-task',
  ORDERS_DELETE_TASK: 'orders:delete-task',
  ORDERS_REORDER_TASKS: 'orders:reorder-tasks',

  WORKFLOW_TEMPLATE_LIST: 'workflowTemplate:list',
  WORKFLOW_TEMPLATE_GET: 'workflowTemplate:get',
  WORKFLOW_TEMPLATE_CREATE: 'workflowTemplate:create',
  WORKFLOW_TEMPLATE_UPDATE: 'workflowTemplate:update',
  WORKFLOW_TEMPLATE_DELETE: 'workflowTemplate:delete',
  WORKFLOW_TEMPLATE_DUPLICATE: 'workflowTemplate:duplicate',

  REVERSE_MAX_PRODUCIBLE: 'reverse:max-producible',

  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  OVERAGE_SET_FOR_ALL: 'overage:set-for-all',

  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT: 'backup:import',
  BACKUP_GET_STATUS: 'backup:get-status',
  BACKUP_OPEN_FOLDER: 'backup:open-folder',

  FILE_SAVE_TEXT: 'file:save-text',
  FILE_OPEN_TEXT: 'file:open-text',

  LLM_IS_AVAILABLE: 'llm:is-available',
  LLM_REWRITE_EMAIL: 'llm:rewrite-email',
  LLM_MATCH_SUGGEST: 'llm:match-suggest',

  DEMO_SEED: 'demo:seed',
  DATA_WIPE: 'data:wipe',

  APP_GET_VERSION: 'app:get-version',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_CHECK_UPDATES: 'app:check-updates',
  APP_DOWNLOAD_UPDATE: 'app:download-update',

  AUTH_SIGN_IN: 'auth:sign-in',
  AUTH_SIGN_OUT: 'auth:sign-out',
  AUTH_GET_SESSION: 'auth:get-session',
  MIGRATION_GET_STATUS: 'migration:get-status',
  MIGRATION_RUN: 'migration:run',
} as const;

contextBridge.exposeInMainWorld('electronAPI', {
  // Suppliers
  listSuppliers: () => ipcRenderer.invoke(CH.SUPPLIERS_LIST),
  getSupplier: (id: string) => ipcRenderer.invoke(CH.SUPPLIERS_GET, id),
  createSupplier: (input: any) => ipcRenderer.invoke(CH.SUPPLIERS_CREATE, input),
  updateSupplier: (id: string, patch: any) => ipcRenderer.invoke(CH.SUPPLIERS_UPDATE, id, patch),
  deleteSupplier: (id: string) => ipcRenderer.invoke(CH.SUPPLIERS_DELETE, id),
  duplicateSupplier: (id: string) => ipcRenderer.invoke(CH.SUPPLIERS_DUPLICATE, id),

  // Raw materials
  listRawMaterials: () => ipcRenderer.invoke(CH.RAW_LIST),
  getRawMaterial: (id: string) => ipcRenderer.invoke(CH.RAW_GET, id),
  createRawMaterial: (input: any) => ipcRenderer.invoke(CH.RAW_CREATE, input),
  updateRawMaterial: (id: string, patch: any) => ipcRenderer.invoke(CH.RAW_UPDATE, id, patch),
  deleteRawMaterial: (id: string) => ipcRenderer.invoke(CH.RAW_DELETE, id),
  duplicateRawMaterial: (id: string) => ipcRenderer.invoke(CH.RAW_DUPLICATE, id),
  importRawMaterialsXlsx: (mode: 'merge' | 'overwrite') =>
    ipcRenderer.invoke(CH.RAW_XLSX_IMPORT, mode),
  analyzeRawStock: () => ipcRenderer.invoke(CH.RAW_MAGAZYN_STOCK_ANALYZE),
  commitRawStock: (args: {
    sourceFile: string;
    analysis: any;
    decisions: any[];
    createItems?: any[];
  }) => ipcRenderer.invoke(CH.RAW_MAGAZYN_STOCK_COMMIT, args),

  // Components
  listComponents: () => ipcRenderer.invoke(CH.COMP_LIST),
  getComponent: (id: string) => ipcRenderer.invoke(CH.COMP_GET, id),
  createComponent: (input: any) => ipcRenderer.invoke(CH.COMP_CREATE, input),
  updateComponent: (id: string, patch: any) => ipcRenderer.invoke(CH.COMP_UPDATE, id, patch),
  deleteComponent: (id: string) => ipcRenderer.invoke(CH.COMP_DELETE, id),
  duplicateComponent: (id: string) => ipcRenderer.invoke(CH.COMP_DUPLICATE, id),
  importComponentsXlsx: (mode: 'merge' | 'overwrite') =>
    ipcRenderer.invoke(CH.COMP_XLSX_IMPORT, mode),
  analyzeMagazynStock: () => ipcRenderer.invoke(CH.COMP_MAGAZYN_STOCK_ANALYZE),
  commitMagazynStock: (args: { sourceFile: string; decisions: any[]; createItems?: any[] }) =>
    ipcRenderer.invoke(CH.COMP_MAGAZYN_STOCK_COMMIT, args),

  // Products
  listProducts: () => ipcRenderer.invoke(CH.PRODUCTS_LIST),
  getProduct: (id: string) => ipcRenderer.invoke(CH.PRODUCTS_GET, id),
  createProduct: (input: any) => ipcRenderer.invoke(CH.PRODUCTS_CREATE, input),
  updateProduct: (id: string, patch: any) => ipcRenderer.invoke(CH.PRODUCTS_UPDATE, id, patch),
  deleteProduct: (id: string) => ipcRenderer.invoke(CH.PRODUCTS_DELETE, id),
  duplicateProduct: (id: string) => ipcRenderer.invoke(CH.PRODUCTS_DUPLICATE, id),
  analyzeRecipesXlsx: (mode: 'merge' | 'overwrite') =>
    ipcRenderer.invoke(CH.PRODUCTS_RECIPES_XLSX_ANALYZE, mode),
  commitRecipesXlsx: (
    filePath: string,
    mode: 'merge' | 'overwrite',
    resolutions: unknown,
  ) =>
    ipcRenderer.invoke(CH.PRODUCTS_RECIPES_XLSX_COMMIT, {
      filePath,
      mode,
      resolutions,
    }),
  exportRecipesXlsx: () => ipcRenderer.invoke(CH.PRODUCTS_RECIPES_XLSX_EXPORT),

  // Stock
  selectStockFiles: () => ipcRenderer.invoke(CH.STOCK_SELECT_FILES),
  importStock: (args: { rawPath?: string; componentPath?: string }) =>
    ipcRenderer.invoke(CH.STOCK_IMPORT, args),
  listStockSnapshots: () => ipcRenderer.invoke(CH.STOCK_LIST_SNAPSHOTS),
  getCurrentStock: () => ipcRenderer.invoke(CH.STOCK_GET_CURRENT),
  resolveStockMatch: (
    snapshotId: string,
    rowKey: string,
    targetKind: 'raw' | 'component',
    targetId: string,
  ) => ipcRenderer.invoke(CH.STOCK_RESOLVE_MATCH, snapshotId, rowKey, targetKind, targetId),
  resolveStockConflicts: (resolutions: any[]) =>
    ipcRenderer.invoke(CH.STOCK_RESOLVE_CONFLICTS, resolutions),
  syncStockCatalog: () => ipcRenderer.invoke(CH.STOCK_SYNC_CATALOG),
  setManualStock: (kind: 'raw' | 'component', itemId: string, qty: number) =>
    ipcRenderer.invoke(CH.STOCK_SET_MANUAL, kind, itemId, qty),
  updateStockRow: (snapshotId: string, rowKey: string, patch: any) =>
    ipcRenderer.invoke(CH.STOCK_UPDATE_ROW, snapshotId, rowKey, patch),
  deleteStockRow: (snapshotId: string, rowKey: string) =>
    ipcRenderer.invoke(CH.STOCK_DELETE_ROW, snapshotId, rowKey),
  deleteStockSnapshot: (snapshotId: string) =>
    ipcRenderer.invoke(CH.STOCK_DELETE_SNAPSHOT, snapshotId),
  deleteStockSnapshotsByKind: (kind: 'raw' | 'component') =>
    ipcRenderer.invoke(CH.STOCK_DELETE_KIND, kind),
  suggestStockMatches: (
    kind: 'raw' | 'component',
    source: { name: string; mpFirmaSymbol?: string },
    limit?: number,
  ) => ipcRenderer.invoke(CH.STOCK_SUGGEST_MATCHES, kind, source, limit),
  importStockFromBsx: () => ipcRenderer.invoke(CH.STOCK_IMPORT_BSX),
  loadBsxPrices: (snapshotIds: { raw?: string; component?: string }) =>
    ipcRenderer.invoke(CH.STOCK_LOAD_BSX_PRICES, snapshotIds),

  // BSX integration (warehouse system)
  testBsxConnection: () => ipcRenderer.invoke(CH.BSX_TEST_CONNECTION),
  setBsxPassword: (password: string) => ipcRenderer.invoke(CH.BSX_SET_PASSWORD, password),
  clearBsxPassword: () => ipcRenderer.invoke(CH.BSX_CLEAR_PASSWORD),
  listBsxWarehouses: () => ipcRenderer.invoke(CH.BSX_LIST_WAREHOUSES),

  // Catalog aliases
  listRawMaterialAliases: () => ipcRenderer.invoke(CH.RAW_ALIAS_LIST),
  addRawMaterialAlias: (targetId: string, alias: string) =>
    ipcRenderer.invoke(CH.RAW_ALIAS_ADD, targetId, alias),
  deleteRawMaterialAlias: (id: string) => ipcRenderer.invoke(CH.RAW_ALIAS_DELETE, id),
  listComponentAliases: () => ipcRenderer.invoke(CH.COMP_ALIAS_LIST),
  addComponentAlias: (targetId: string, alias: string) =>
    ipcRenderer.invoke(CH.COMP_ALIAS_ADD, targetId, alias),
  deleteComponentAlias: (id: string) => ipcRenderer.invoke(CH.COMP_ALIAS_DELETE, id),

  // Plans
  listPlans: () => ipcRenderer.invoke(CH.PLAN_LIST),
  getPlan: (id: string) => ipcRenderer.invoke(CH.PLAN_GET, id),
  createPlan: (input: any) => ipcRenderer.invoke(CH.PLAN_CREATE, input),
  updatePlan: (id: string, patch: any) => ipcRenderer.invoke(CH.PLAN_UPDATE, id, patch),
  deletePlan: (id: string) => ipcRenderer.invoke(CH.PLAN_DELETE, id),
  duplicatePlan: (id: string) => ipcRenderer.invoke(CH.PLAN_DUPLICATE, id),
  computeShortages: (
    planId: string,
    orderId?: string,
    includeExpiredBatchIds?: string[],
    acceptedDependencyIds?: string[],
    substitutions?: Record<string, string>,
  ) =>
    ipcRenderer.invoke(
      CH.PLAN_COMPUTE_SHORTAGES,
      planId,
      orderId,
      includeExpiredBatchIds,
      acceptedDependencyIds,
      substitutions,
    ),
  previewExpiredForPlan: (planId: string) => ipcRenderer.invoke(CH.PLAN_PREVIEW_EXPIRED, planId),
  previewDependencyShortages: (planId: string, includeExpiredBatchIds?: string[]) =>
    ipcRenderer.invoke(CH.PLAN_PREVIEW_DEPENDENCY_SHORTAGES, planId, includeExpiredBatchIds),
  computeCost: (planId: string) => ipcRenderer.invoke(CH.PLAN_COMPUTE_COST, planId),

  // Shortage report history
  listShortageReports: () => ipcRenderer.invoke(CH.SHORTAGE_REPORT_LIST),
  getShortageReport: (id: string) => ipcRenderer.invoke(CH.SHORTAGE_REPORT_GET, id),
  deleteShortageReport: (id: string) => ipcRenderer.invoke(CH.SHORTAGE_REPORT_DELETE, id),
  updateShortageReport: (
    id: string,
    patch: { reportName?: string; orderId?: string | null; archived?: boolean },
  ) => ipcRenderer.invoke(CH.SHORTAGE_REPORT_UPDATE, id, patch),
  setReportSupplierReceived: (
    reportId: string,
    supplierId: string,
    receivedAt: string | null,
  ) =>
    ipcRenderer.invoke(
      CH.SHORTAGE_REPORT_SET_SUPPLIER_RECEIVED,
      reportId,
      supplierId,
      receivedAt,
    ),

  // Email batches (RFQ history)
  generateEmails: (
    reportId: string,
    opts: { language: 'pl' | 'en'; useAI: boolean; sendToAllAlternatives?: boolean },
  ) => ipcRenderer.invoke(CH.EMAIL_BATCH_CREATE, reportId, opts),
  listEmailBatches: () => ipcRenderer.invoke(CH.EMAIL_BATCH_LIST),
  getEmailBatch: (id: string) => ipcRenderer.invoke(CH.EMAIL_BATCH_GET, id),
  deleteEmailBatch: (id: string) => ipcRenderer.invoke(CH.EMAIL_BATCH_DELETE, id),
  updateEmailBatch: (
    id: string,
    patch: { batchName?: string; orderId?: string | null },
  ) => ipcRenderer.invoke(CH.EMAIL_BATCH_UPDATE, id, patch),
  updateBatchEmail: (
    batchId: string,
    emailId: string,
    patch: {
      body?: string;
      subject?: string;
      supplierId?: string;
      supplierName?: string;
      to?: string;
    },
  ) => ipcRenderer.invoke(CH.EMAIL_BATCH_UPDATE_EMAIL, batchId, emailId, patch),
  markEmailSent: (batchId: string, emailId: string, sentAt: string | null) =>
    ipcRenderer.invoke(CH.EMAIL_BATCH_MARK_SENT, batchId, emailId, sentAt),
  regenerateBatchEmail: (
    batchId: string,
    emailId: string,
    opts: { language: 'pl' | 'en'; useAI: boolean },
  ) => ipcRenderer.invoke(CH.EMAIL_BATCH_REGENERATE_EMAIL, batchId, emailId, opts),

  // Orders
  listOrders: () => ipcRenderer.invoke(CH.ORDERS_LIST),
  getOrder: (id: string) => ipcRenderer.invoke(CH.ORDERS_GET, id),
  createOrder: (input: any) => ipcRenderer.invoke(CH.ORDERS_CREATE, input),
  updateOrder: (id: string, patch: any) => ipcRenderer.invoke(CH.ORDERS_UPDATE, id, patch),
  deleteOrder: (id: string) => ipcRenderer.invoke(CH.ORDERS_DELETE, id),
  duplicateOrder: (id: string) => ipcRenderer.invoke(CH.ORDERS_DUPLICATE, id),
  attachWorkflowToOrder: (orderId: string, templateId: string) =>
    ipcRenderer.invoke(CH.ORDERS_ATTACH_WORKFLOW, orderId, templateId),
  detachWorkflowFromOrder: (orderId: string) =>
    ipcRenderer.invoke(CH.ORDERS_DETACH_WORKFLOW, orderId),
  updateOrderTask: (orderId: string, taskId: string, patch: any) =>
    ipcRenderer.invoke(CH.ORDERS_UPDATE_TASK, orderId, taskId, patch),
  addOrderTask: (orderId: string, input: any, insertAtIndex?: number) =>
    ipcRenderer.invoke(CH.ORDERS_ADD_TASK, orderId, input, insertAtIndex),
  deleteOrderTask: (orderId: string, taskId: string) =>
    ipcRenderer.invoke(CH.ORDERS_DELETE_TASK, orderId, taskId),
  reorderOrderTasks: (orderId: string, fromIndex: number, toIndex: number) =>
    ipcRenderer.invoke(CH.ORDERS_REORDER_TASKS, orderId, fromIndex, toIndex),

  // Workflow templates
  listWorkflowTemplates: () => ipcRenderer.invoke(CH.WORKFLOW_TEMPLATE_LIST),
  getWorkflowTemplate: (id: string) => ipcRenderer.invoke(CH.WORKFLOW_TEMPLATE_GET, id),
  createWorkflowTemplate: (input: any) =>
    ipcRenderer.invoke(CH.WORKFLOW_TEMPLATE_CREATE, input),
  updateWorkflowTemplate: (id: string, patch: any) =>
    ipcRenderer.invoke(CH.WORKFLOW_TEMPLATE_UPDATE, id, patch),
  deleteWorkflowTemplate: (id: string) =>
    ipcRenderer.invoke(CH.WORKFLOW_TEMPLATE_DELETE, id),
  duplicateWorkflowTemplate: (id: string) =>
    ipcRenderer.invoke(CH.WORKFLOW_TEMPLATE_DUPLICATE, id),

  // Reverse
  maxProducible: (
    productId: string,
    includeExpiredBatchIds?: string[],
    acceptedDependencyIds?: string[],
    substitutions?: Record<string, string>,
  ) =>
    ipcRenderer.invoke(
      CH.REVERSE_MAX_PRODUCIBLE,
      productId,
      includeExpiredBatchIds,
      acceptedDependencyIds,
      substitutions,
    ),

  // Settings
  getSettings: () => ipcRenderer.invoke(CH.SETTINGS_GET),
  updateSettings: (patch: any) => ipcRenderer.invoke(CH.SETTINGS_UPDATE, patch),
  setOveragePctForAll: (kind: 'raw' | 'component', pct: number | null) =>
    ipcRenderer.invoke(CH.OVERAGE_SET_FOR_ALL, kind, pct),

  // Backup
  exportBackup: () => ipcRenderer.invoke(CH.BACKUP_EXPORT),
  importBackup: (mode: 'merge' | 'replace') => ipcRenderer.invoke(CH.BACKUP_IMPORT, mode),
  backupGetStatus: () => ipcRenderer.invoke(CH.BACKUP_GET_STATUS),
  backupOpenFolder: () => ipcRenderer.invoke(CH.BACKUP_OPEN_FOLDER),

  // Generic file save/open
  saveTextFile: (args: {
    defaultName: string;
    content: string;
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => ipcRenderer.invoke(CH.FILE_SAVE_TEXT, args),
  openTextFile: (args?: {
    title?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => ipcRenderer.invoke(CH.FILE_OPEN_TEXT, args ?? {}),

  // LLM
  isAiAvailable: () => ipcRenderer.invoke(CH.LLM_IS_AVAILABLE),
  rewriteEmailWithAI: (
    draftBody: string,
    language: 'pl' | 'en',
    ctx?: { supplierName?: string },
  ) => ipcRenderer.invoke(CH.LLM_REWRITE_EMAIL, draftBody, language, ctx),
  suggestMatchWithAI: (sourceName: string, candidates: { id: string; name: string }[]) =>
    ipcRenderer.invoke(CH.LLM_MATCH_SUGGEST, sourceName, candidates),

  // Demo / data
  seedDemo: () => ipcRenderer.invoke(CH.DEMO_SEED),
  wipeData: () => ipcRenderer.invoke(CH.DATA_WIPE),

  // App
  getAppVersion: () => ipcRenderer.invoke(CH.APP_GET_VERSION),
  openExternal: (url: string) => ipcRenderer.invoke(CH.APP_OPEN_EXTERNAL, url),
  checkForUpdates: () => ipcRenderer.invoke(CH.APP_CHECK_UPDATES),
  downloadUpdate: () => ipcRenderer.invoke(CH.APP_DOWNLOAD_UPDATE),

  onUpdateAvailable: (cb: (info: any) => void) =>
    ipcRenderer.on('update-available', (_e: IpcRendererEvent, info) => cb(info)),
  onUpdateDownloaded: (cb: (info: any) => void) =>
    ipcRenderer.on('update-downloaded', (_e: IpcRendererEvent, info) => cb(info)),
  onUpdateError: (cb: (msg: string) => void) =>
    ipcRenderer.on('update-error', (_e: IpcRendererEvent, msg) => cb(msg)),
  onDownloadProgress: (cb: (p: any) => void) =>
    ipcRenderer.on('download-progress', (_e: IpcRendererEvent, p) => cb(p)),
  onBackupCreated: (cb: (info: any) => void) => {
    const listener = (_e: IpcRendererEvent, info: any) => cb(info);
    ipcRenderer.on('backup:auto-created', listener);
    return () => ipcRenderer.off('backup:auto-created', listener);
  },
  onBackupStarted: (cb: (info: any) => void) => {
    const listener = (_e: IpcRendererEvent, info: any) => cb(info);
    ipcRenderer.on('backup:auto-started', listener);
    return () => ipcRenderer.off('backup:auto-started', listener);
  },
  onBackupFailed: (cb: (info: any) => void) => {
    const listener = (_e: IpcRendererEvent, info: any) => cb(info);
    ipcRenderer.on('backup:auto-failed', listener);
    return () => ipcRenderer.off('backup:auto-failed', listener);
  },

  // Zoom (in-renderer only — uses webFrame, no IPC needed)
  getZoomFactor: () => webFrame.getZoomFactor(),
  setZoomFactor: (factor: number) => webFrame.setZoomFactor(factor),

  // Auth (Supabase)
  authSignIn: (email: string, password: string) =>
    ipcRenderer.invoke(CH.AUTH_SIGN_IN, email, password),
  authSignOut: () => ipcRenderer.invoke(CH.AUTH_SIGN_OUT),
  authGetSession: () => ipcRenderer.invoke(CH.AUTH_GET_SESSION),

  // One-time local→cloud migration
  migrationGetStatus: () => ipcRenderer.invoke(CH.MIGRATION_GET_STATUS),
  migrationRun: () => ipcRenderer.invoke(CH.MIGRATION_RUN),

  platform: process.platform,
});
