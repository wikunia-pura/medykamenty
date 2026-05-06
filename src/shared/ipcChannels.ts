export const IPC = {
  // Suppliers
  SUPPLIERS_LIST: 'suppliers:list',
  SUPPLIERS_GET: 'suppliers:get',
  SUPPLIERS_CREATE: 'suppliers:create',
  SUPPLIERS_UPDATE: 'suppliers:update',
  SUPPLIERS_DELETE: 'suppliers:delete',

  // Raw materials
  RAW_LIST: 'rawMaterials:list',
  RAW_GET: 'rawMaterials:get',
  RAW_CREATE: 'rawMaterials:create',
  RAW_UPDATE: 'rawMaterials:update',
  RAW_DELETE: 'rawMaterials:delete',

  // Components
  COMP_LIST: 'components:list',
  COMP_GET: 'components:get',
  COMP_CREATE: 'components:create',
  COMP_UPDATE: 'components:update',
  COMP_DELETE: 'components:delete',

  // Products
  PRODUCTS_LIST: 'products:list',
  PRODUCTS_GET: 'products:get',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_DUPLICATE: 'products:duplicate',

  // Stock
  STOCK_SELECT_FILES: 'stock:select-files',
  STOCK_IMPORT: 'stock:import',
  STOCK_LIST_SNAPSHOTS: 'stock:list-snapshots',
  STOCK_GET_CURRENT: 'stock:get-current',
  STOCK_RESOLVE_MATCH: 'stock:resolve-match',

  // Plan
  PLAN_LIST: 'plan:list',
  PLAN_GET: 'plan:get',
  PLAN_CREATE: 'plan:create',
  PLAN_UPDATE: 'plan:update',
  PLAN_DELETE: 'plan:delete',
  PLAN_COMPUTE_SHORTAGES: 'plan:compute-shortages',
  PLAN_COMPUTE_COST: 'plan:compute-cost',
  PLAN_GENERATE_EMAILS: 'plan:generate-emails',

  // Reverse
  REVERSE_MAX_PRODUCIBLE: 'reverse:max-producible',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Backup
  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT: 'backup:import',

  // LLM
  LLM_IS_AVAILABLE: 'llm:is-available',
  LLM_REWRITE_EMAIL: 'llm:rewrite-email',
  LLM_MATCH_SUGGEST: 'llm:match-suggest',

  // Demo
  DEMO_SEED: 'demo:seed',

  // App
  APP_GET_VERSION: 'app:get-version',
  APP_OPEN_EXTERNAL: 'app:open-external',
  APP_CHECK_UPDATES: 'app:check-updates',
  APP_DOWNLOAD_UPDATE: 'app:download-update',

  // Auto-update events (main → renderer)
  EVT_UPDATE_AVAILABLE: 'update-available',
  EVT_UPDATE_DOWNLOADED: 'update-downloaded',
  EVT_UPDATE_ERROR: 'update-error',
  EVT_DOWNLOAD_PROGRESS: 'download-progress',
} as const;
