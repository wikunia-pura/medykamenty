// Per-item overage ("naddatek") helpers.
//
// Overage is stored per raw material / per component as a percentage on top of
// the bare requirement (e.g. 5 == +5%). Items without an explicit value inherit
// the type-level default from AppSettings (defaultOveragePctRaw /
// defaultOveragePctComponent). Calculations multiply the bare requirement by
// the resulting factor.

/** Resolve the effective overage percentage for an item, falling back to the type default. */
export function effectiveOveragePct(itemPct: number | undefined, defaultPct: number): number {
  return itemPct ?? defaultPct;
}

/** Convert an overage percentage (5) into a multiplier (1.05). */
export function overagePctToFactor(pct: number): number {
  return 1 + pct / 100;
}

/** Effective multiplier for an item, falling back to the type default. */
export function effectiveOverageFactor(itemPct: number | undefined, defaultPct: number): number {
  return overagePctToFactor(effectiveOveragePct(itemPct, defaultPct));
}
