import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

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

  PLAN_LIST: 'plan:list',
  PLAN_GET: 'plan:get',
  PLAN_CREATE: 'plan:create',
  PLAN_UPDATE: 'plan:update',
  PLAN_DELETE: 'plan:delete',
  PLAN_COMPUTE_SHORTAGES: 'plan:compute-shortages',
  PLAN_COMPUTE_COST: 'plan:compute-cost',
  PLAN_GENERATE_EMAILS: 'plan:generate-emails',

  REVERSE_MAX_PRODUCIBLE: 'reverse:max-producible',

  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT: 'backup:import',

  LLM_IS_AVAILABLE: 'llm:is-available',
  LLM_REWRITE_EMAIL: 'llm:rewrite-email',
  LLM_MATCH_SUGGEST: 'llm:match-suggest',

  DEMO_SEED: 'demo:seed',

  APP_GET_VERSION: 'app:get-version',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_CHECK_UPDATES: 'app:check-updates',
  APP_DOWNLOAD_UPDATE: 'app:download-update',
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

  // Plans
  listPlans: () => ipcRenderer.invoke(CH.PLAN_LIST),
  getPlan: (id: string) => ipcRenderer.invoke(CH.PLAN_GET, id),
  createPlan: (input: any) => ipcRenderer.invoke(CH.PLAN_CREATE, input),
  updatePlan: (id: string, patch: any) => ipcRenderer.invoke(CH.PLAN_UPDATE, id, patch),
  deletePlan: (id: string) => ipcRenderer.invoke(CH.PLAN_DELETE, id),
  computeShortages: (planId: string) => ipcRenderer.invoke(CH.PLAN_COMPUTE_SHORTAGES, planId),
  computeCost: (planId: string) => ipcRenderer.invoke(CH.PLAN_COMPUTE_COST, planId),
  generateEmails: (
    planId: string,
    opts: { language: 'pl' | 'en'; useAI: boolean; sendToAllAlternatives?: boolean },
  ) => ipcRenderer.invoke(CH.PLAN_GENERATE_EMAILS, planId, opts),

  // Reverse
  maxProducible: (productId: string) => ipcRenderer.invoke(CH.REVERSE_MAX_PRODUCIBLE, productId),

  // Settings
  getSettings: () => ipcRenderer.invoke(CH.SETTINGS_GET),
  updateSettings: (patch: any) => ipcRenderer.invoke(CH.SETTINGS_UPDATE, patch),

  // Backup
  exportBackup: () => ipcRenderer.invoke(CH.BACKUP_EXPORT),
  importBackup: (mode: 'merge' | 'replace') => ipcRenderer.invoke(CH.BACKUP_IMPORT, mode),

  // LLM
  isAiAvailable: () => ipcRenderer.invoke(CH.LLM_IS_AVAILABLE),
  rewriteEmailWithAI: (
    draftBody: string,
    language: 'pl' | 'en',
    ctx?: { supplierName?: string },
  ) => ipcRenderer.invoke(CH.LLM_REWRITE_EMAIL, draftBody, language, ctx),
  suggestMatchWithAI: (sourceName: string, candidates: { id: string; name: string }[]) =>
    ipcRenderer.invoke(CH.LLM_MATCH_SUGGEST, sourceName, candidates),

  // Demo
  seedDemo: () => ipcRenderer.invoke(CH.DEMO_SEED),

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

  platform: process.platform,
});
