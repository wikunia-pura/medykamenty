export const IPC = {
  // Suppliers
  SUPPLIERS_LIST: 'suppliers:list',
  SUPPLIERS_GET: 'suppliers:get',
  SUPPLIERS_CREATE: 'suppliers:create',
  SUPPLIERS_UPDATE: 'suppliers:update',
  SUPPLIERS_DELETE: 'suppliers:delete',
  SUPPLIERS_DUPLICATE: 'suppliers:duplicate',

  // Raw materials
  RAW_LIST: 'rawMaterials:list',
  RAW_GET: 'rawMaterials:get',
  RAW_CREATE: 'rawMaterials:create',
  RAW_UPDATE: 'rawMaterials:update',
  RAW_DELETE: 'rawMaterials:delete',
  RAW_DUPLICATE: 'rawMaterials:duplicate',
  RAW_XLSX_IMPORT: 'rawMaterials:xlsx-import',
  RAW_MAGAZYN_STOCK_ANALYZE: 'rawMaterials:magazyn-stock-analyze',
  RAW_MAGAZYN_STOCK_COMMIT: 'rawMaterials:magazyn-stock-commit',

  // Components
  COMP_LIST: 'components:list',
  COMP_GET: 'components:get',
  COMP_CREATE: 'components:create',
  COMP_UPDATE: 'components:update',
  COMP_DELETE: 'components:delete',
  COMP_DUPLICATE: 'components:duplicate',
  COMP_XLSX_IMPORT: 'components:xlsx-import',
  COMP_MAGAZYN_STOCK_ANALYZE: 'components:magazyn-stock-analyze',
  COMP_MAGAZYN_STOCK_COMMIT: 'components:magazyn-stock-commit',

  // Products
  PRODUCTS_LIST: 'products:list',
  PRODUCTS_GET: 'products:get',
  PRODUCTS_CREATE: 'products:create',
  PRODUCTS_UPDATE: 'products:update',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_DUPLICATE: 'products:duplicate',
  PRODUCTS_RECIPES_XLSX_ANALYZE: 'products:recipes-xlsx-analyze',
  PRODUCTS_RECIPES_XLSX_COMMIT: 'products:recipes-xlsx-commit',
  PRODUCTS_RECIPES_XLSX_EXPORT: 'products:recipes-xlsx-export',

  // Stock
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

  // BSX integration (warehouse system)
  BSX_TEST_CONNECTION: 'bsx:test-connection',
  BSX_SET_PASSWORD: 'bsx:set-password',
  BSX_CLEAR_PASSWORD: 'bsx:clear-password',
  BSX_LIST_WAREHOUSES: 'bsx:list-warehouses',

  // Catalog aliases (smart fuzzy mappings learned from stock import)
  RAW_ALIAS_LIST: 'rawMaterials:alias-list',
  RAW_ALIAS_ADD: 'rawMaterials:alias-add',
  RAW_ALIAS_DELETE: 'rawMaterials:alias-delete',
  COMP_ALIAS_LIST: 'components:alias-list',
  COMP_ALIAS_ADD: 'components:alias-add',
  COMP_ALIAS_DELETE: 'components:alias-delete',

  // Plan
  PLAN_LIST: 'plan:list',
  PLAN_GET: 'plan:get',
  PLAN_CREATE: 'plan:create',
  PLAN_UPDATE: 'plan:update',
  PLAN_DELETE: 'plan:delete',
  PLAN_DUPLICATE: 'plan:duplicate',
  PLAN_COMPUTE_SHORTAGES: 'plan:compute-shortages',
  PLAN_PREVIEW_EXPIRED: 'plan:preview-expired',
  PLAN_COMPUTE_COST: 'plan:compute-cost',

  // Shortage report history
  SHORTAGE_REPORT_LIST: 'shortageReport:list',
  SHORTAGE_REPORT_GET: 'shortageReport:get',
  SHORTAGE_REPORT_DELETE: 'shortageReport:delete',
  SHORTAGE_REPORT_UPDATE: 'shortageReport:update',
  SHORTAGE_REPORT_SET_SUPPLIER_RECEIVED: 'shortageReport:set-supplier-received',

  // Email batches (RFQ history)
  EMAIL_BATCH_CREATE: 'emailBatch:create',
  EMAIL_BATCH_LIST: 'emailBatch:list',
  EMAIL_BATCH_GET: 'emailBatch:get',
  EMAIL_BATCH_DELETE: 'emailBatch:delete',
  EMAIL_BATCH_UPDATE: 'emailBatch:update',
  EMAIL_BATCH_UPDATE_EMAIL: 'emailBatch:update-email',
  EMAIL_BATCH_MARK_SENT: 'emailBatch:mark-sent',
  EMAIL_BATCH_REGENERATE_EMAIL: 'emailBatch:regenerate-email',

  // Orders
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

  // Workflow templates
  WORKFLOW_TEMPLATE_LIST: 'workflowTemplate:list',
  WORKFLOW_TEMPLATE_GET: 'workflowTemplate:get',
  WORKFLOW_TEMPLATE_CREATE: 'workflowTemplate:create',
  WORKFLOW_TEMPLATE_UPDATE: 'workflowTemplate:update',
  WORKFLOW_TEMPLATE_DELETE: 'workflowTemplate:delete',
  WORKFLOW_TEMPLATE_DUPLICATE: 'workflowTemplate:duplicate',

  // Reverse
  REVERSE_MAX_PRODUCIBLE: 'reverse:max-producible',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Overage ("naddatek") bulk action
  OVERAGE_SET_FOR_ALL: 'overage:set-for-all',

  // Backup
  BACKUP_EXPORT: 'backup:export',
  BACKUP_IMPORT: 'backup:import',
  BACKUP_GET_STATUS: 'backup:get-status',
  BACKUP_OPEN_FOLDER: 'backup:open-folder',

  // Auto-backup event (main → renderer)
  EVT_BACKUP_CREATED: 'backup:auto-created',

  // Generic file save/open (per-view export/import)
  FILE_SAVE_TEXT: 'file:save-text',
  FILE_OPEN_TEXT: 'file:open-text',

  // LLM
  LLM_IS_AVAILABLE: 'llm:is-available',
  LLM_REWRITE_EMAIL: 'llm:rewrite-email',
  LLM_MATCH_SUGGEST: 'llm:match-suggest',

  // Demo / data
  DEMO_SEED: 'demo:seed',
  DATA_WIPE: 'data:wipe',

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

  // Auth (Supabase-backed)
  AUTH_SIGN_IN: 'auth:sign-in',
  AUTH_SIGN_OUT: 'auth:sign-out',
  AUTH_GET_SESSION: 'auth:get-session',

  // One-time local→cloud migration
  MIGRATION_GET_STATUS: 'migration:get-status',
  MIGRATION_RUN: 'migration:run',
} as const;
