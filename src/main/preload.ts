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

  RAW_LIST: 'rawMaterials:list',
  RAW_GET: 'rawMaterials:get',
  RAW_CREATE: 'rawMaterials:create',
  RAW_UPDATE: 'rawMaterials:update',
  RAW_DELETE: 'rawMaterials:delete',

  COMP_LIST: 'components:list',
  COMP_GET: 'components:get',
  COMP_CREATE: 'components:create',
  COMP_UPDATE: 'components:update',
  COMP_DELETE: 'components:delete',

  PRODUCTS_LIST: 'products:list',
  PRODUCTS_GET: 'products:get',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_DUPLICATE: 'products:duplicate',

  STOCK_SELECT_FILES: 'stock:select-files',
  STOCK_IMPORT: 'stock:import',
  STOCK_LIST_SNAPSHOTS: 'stock:list-snapshots',
  STOCK_GET_CURRENT: 'stock:get-current',
  STOCK_RESOLVE_MATCH: 'stock:resolve-match',
  STOCK_UPDATE_ROW: 'stock:update-row',
  STOCK_DELETE_ROW: 'stock:delete-row',
  STOCK_DELETE_SNAPSHOT: 'stock:delete-snapshot',
  STOCK_DELETE_KIND: 'stock:delete-kind',

  PLAN_LIST: 'plan:list',
  PLAN_GET: 'plan:get',
  PLAN_CREATE: 'plan:create',
  PLAN_UPDATE: 'plan:update',
  PLAN_DELETE: 'plan:delete',
  PLAN_DUPLICATE: 'plan:duplicate',
  PLAN_COMPUTE_SHORTAGES: 'plan:compute-shortages',
  PLAN_COMPUTE_COST: 'plan:compute-cost',

  SHORTAGE_REPORT_LIST: 'shortageReport:list',
  SHORTAGE_REPORT_GET: 'shortageReport:get',
  SHORTAGE_REPORT_DELETE: 'shortageReport:delete',
  SHORTAGE_REPORT_UPDATE: 'shortageReport:update',

  EMAIL_BATCH_CREATE: 'emailBatch:create',
  EMAIL_BATCH_LIST: 'emailBatch:list',
  EMAIL_BATCH_GET: 'emailBatch:get',
  EMAIL_BATCH_DELETE: 'emailBatch:delete',
  EMAIL_BATCH_UPDATE_EMAIL: 'emailBatch:update-email',
  EMAIL_BATCH_MARK_SENT: 'emailBatch:mark-sent',
  EMAIL_BATCH_REGENERATE_EMAIL: 'emailBatch:regenerate-email',

  REVERSE_MAX_PRODUCIBLE: 'reverse:max-producible',

  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT: 'backup:import',

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

  // Raw materials
  listRawMaterials: () => ipcRenderer.invoke(CH.RAW_LIST),
  getRawMaterial: (id: string) => ipcRenderer.invoke(CH.RAW_GET, id),
  createRawMaterial: (input: any) => ipcRenderer.invoke(CH.RAW_CREATE, input),
  updateRawMaterial: (id: string, patch: any) => ipcRenderer.invoke(CH.RAW_UPDATE, id, patch),
  deleteRawMaterial: (id: string) => ipcRenderer.invoke(CH.RAW_DELETE, id),

  // Components
  listComponents: () => ipcRenderer.invoke(CH.COMP_LIST),
  getComponent: (id: string) => ipcRenderer.invoke(CH.COMP_GET, id),
  createComponent: (input: any) => ipcRenderer.invoke(CH.COMP_CREATE, input),
  updateComponent: (id: string, patch: any) => ipcRenderer.invoke(CH.COMP_UPDATE, id, patch),
  deleteComponent: (id: string) => ipcRenderer.invoke(CH.COMP_DELETE, id),

  // Products
  listProducts: () => ipcRenderer.invoke(CH.PRODUCTS_LIST),
  getProduct: (id: string) => ipcRenderer.invoke(CH.PRODUCTS_GET, id),
  createProduct: (input: any) => ipcRenderer.invoke(CH.PRODUCTS_CREATE, input),
  updateProduct: (id: string, patch: any) => ipcRenderer.invoke(CH.PRODUCTS_UPDATE, id, patch),
  deleteProduct: (id: string) => ipcRenderer.invoke(CH.PRODUCTS_DELETE, id),
  duplicateProduct: (id: string) => ipcRenderer.invoke(CH.PRODUCTS_DUPLICATE, id),

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
  updateStockRow: (snapshotId: string, rowKey: string, patch: any) =>
    ipcRenderer.invoke(CH.STOCK_UPDATE_ROW, snapshotId, rowKey, patch),
  deleteStockRow: (snapshotId: string, rowKey: string) =>
    ipcRenderer.invoke(CH.STOCK_DELETE_ROW, snapshotId, rowKey),
  deleteStockSnapshot: (snapshotId: string) =>
    ipcRenderer.invoke(CH.STOCK_DELETE_SNAPSHOT, snapshotId),
  deleteStockSnapshotsByKind: (kind: 'raw' | 'component') =>
    ipcRenderer.invoke(CH.STOCK_DELETE_KIND, kind),

  // Plans
  listPlans: () => ipcRenderer.invoke(CH.PLAN_LIST),
  getPlan: (id: string) => ipcRenderer.invoke(CH.PLAN_GET, id),
  createPlan: (input: any) => ipcRenderer.invoke(CH.PLAN_CREATE, input),
  updatePlan: (id: string, patch: any) => ipcRenderer.invoke(CH.PLAN_UPDATE, id, patch),
  deletePlan: (id: string) => ipcRenderer.invoke(CH.PLAN_DELETE, id),
  duplicatePlan: (id: string) => ipcRenderer.invoke(CH.PLAN_DUPLICATE, id),
  computeShortages: (planId: string) => ipcRenderer.invoke(CH.PLAN_COMPUTE_SHORTAGES, planId),
  computeCost: (planId: string) => ipcRenderer.invoke(CH.PLAN_COMPUTE_COST, planId),

  // Shortage report history
  listShortageReports: () => ipcRenderer.invoke(CH.SHORTAGE_REPORT_LIST),
  getShortageReport: (id: string) => ipcRenderer.invoke(CH.SHORTAGE_REPORT_GET, id),
  deleteShortageReport: (id: string) => ipcRenderer.invoke(CH.SHORTAGE_REPORT_DELETE, id),
  updateShortageReport: (id: string, patch: { reportName?: string }) =>
    ipcRenderer.invoke(CH.SHORTAGE_REPORT_UPDATE, id, patch),

  // Email batches (RFQ history)
  generateEmails: (
    reportId: string,
    opts: { language: 'pl' | 'en'; useAI: boolean; sendToAllAlternatives?: boolean },
  ) => ipcRenderer.invoke(CH.EMAIL_BATCH_CREATE, reportId, opts),
  listEmailBatches: () => ipcRenderer.invoke(CH.EMAIL_BATCH_LIST),
  getEmailBatch: (id: string) => ipcRenderer.invoke(CH.EMAIL_BATCH_GET, id),
  deleteEmailBatch: (id: string) => ipcRenderer.invoke(CH.EMAIL_BATCH_DELETE, id),
  updateBatchEmail: (
    batchId: string,
    emailId: string,
    patch: { body?: string; subject?: string },
  ) => ipcRenderer.invoke(CH.EMAIL_BATCH_UPDATE_EMAIL, batchId, emailId, patch),
  markEmailSent: (batchId: string, emailId: string, sentAt: string | null) =>
    ipcRenderer.invoke(CH.EMAIL_BATCH_MARK_SENT, batchId, emailId, sentAt),
  regenerateBatchEmail: (
    batchId: string,
    emailId: string,
    opts: { language: 'pl' | 'en'; useAI: boolean },
  ) => ipcRenderer.invoke(CH.EMAIL_BATCH_REGENERATE_EMAIL, batchId, emailId, opts),

  // Reverse
  maxProducible: (productId: string) => ipcRenderer.invoke(CH.REVERSE_MAX_PRODUCIBLE, productId),

  // Settings
  getSettings: () => ipcRenderer.invoke(CH.SETTINGS_GET),
  updateSettings: (patch: any) => ipcRenderer.invoke(CH.SETTINGS_UPDATE, patch),

  // Backup
  exportBackup: () => ipcRenderer.invoke(CH.BACKUP_EXPORT),
  importBackup: (mode: 'merge' | 'replace') => ipcRenderer.invoke(CH.BACKUP_IMPORT, mode),

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
