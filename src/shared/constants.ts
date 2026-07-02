export const APP_NAME = 'Cutis Production Planner';
export const STORE_SCHEMA_VERSION = 1;

export const DEFAULT_WASTE_FACTOR = 1.05;
// Per-item overage ("naddatek") expressed as a percentage on top of the bare
// requirement. 5 == +5% == the legacy global wasteFactor of 1.05. Applied
// per raw material / per component, with these as the type-level defaults for
// items that have no explicit value of their own.
export const DEFAULT_OVERAGE_PCT = 5;
export const DEFAULT_CURRENCY = 'PLN';
export const DEFAULT_LANGUAGE: 'pl' | 'en' = 'pl';
export const DEFAULT_AI_MODEL = 'claude-sonnet-4-6';

export const STOCK_SNAPSHOT_RETENTION = 10;
export const FUZZY_MATCH_THRESHOLD = 0.85;
export const SHORTAGE_REPORT_RETENTION = 50;
export const EMAIL_BATCH_RETENTION = 50;
