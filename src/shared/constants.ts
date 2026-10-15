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
export const DEFAULT_AI_MODEL = 'claude-haiku-5-5';

export const STOCK_SNAPSHOT_RETENTION = 10;
export const FUZZY_MATCH_THRESHOLD = 0.85;
// How many past price changes a raw material / component keeps on its
// `priceHistory`. Newest first; older entries are dropped on write.
export const PRICE_HISTORY_LIMIT = 10;
