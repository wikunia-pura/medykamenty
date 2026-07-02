// Pure, dependency-free helpers for reasoning about stock batch expiry.
// Shared by the main-process calculators (shortage / max-producible) and the
// renderer (catalog view, filters, tooltips) so both agree on what "expired",
// "effective expiry" and "available quantity" mean.

import type { ExpiredBatchRef, RawMaterial, StockBatch, Unit } from './types';

// The expiry that actually governs the batch: a physico-chemical retest
// (column H) extends the shelf life, so when present it wins over the original
// "Data ważności" (column F). Returns undefined for batches with no expiry.
export function effectiveExpiry(batch: StockBatch): string | undefined {
  return batch.retestExpiryDate ?? batch.expiryDate;
}

// Parse an ISO date (YYYY-MM-DD or full ISO) to a Date at local midnight, so
// day-granularity comparisons ignore the time component. Returns null on junk.
function parseDate(iso: string | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

// Midnight of `asOf` (defaults to today) — the reference "now" for expiry.
function startOfDay(asOf: Date): Date {
  const d = new Date(asOf.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
}

// A batch with no effective expiry never expires. Otherwise it is expired once
// its effective expiry is strictly before `asOf` (an item expiring *today* is
// still usable today).
export function isExpired(batch: StockBatch, asOf: Date = new Date()): boolean {
  const exp = parseDate(effectiveExpiry(batch));
  if (!exp) return false;
  return exp.getTime() < startOfDay(asOf).getTime();
}

// Whole days from `asOf` until the batch's effective expiry. Negative when
// already expired, undefined when the batch has no expiry.
export function daysUntilExpiry(batch: StockBatch, asOf: Date = new Date()): number | undefined {
  const exp = parseDate(effectiveExpiry(batch));
  if (!exp) return undefined;
  const ms = exp.getTime() - startOfDay(asOf).getTime();
  return Math.round(ms / 86_400_000);
}

export type ExpiryStatus = 'none' | 'ok' | 'expiring' | 'expired';

// Classify a batch relative to a "expiring soon" window of `withinDays`.
export function batchExpiryStatus(
  batch: StockBatch,
  withinDays: number,
  asOf: Date = new Date(),
): ExpiryStatus {
  const days = daysUntilExpiry(batch, asOf);
  if (days === undefined) return 'none';
  if (days < 0) return 'expired';
  if (days <= withinDays) return 'expiring';
  return 'ok';
}

// Available quantity for a material, honouring expiry. A batch counts when it
// is not expired, or when its id is in `includeExpiredBatchIds` (the per-run
// user decision to treat expired stock as valid anyway). Materials without
// batches fall back to the flat `stockQty`.
export function availableStockQty(
  rm: Pick<RawMaterial, 'stockQty' | 'stockBatches'>,
  asOf: Date = new Date(),
  includeExpiredBatchIds?: Set<string>,
): number {
  const batches = rm.stockBatches;
  if (!batches || batches.length === 0) return rm.stockQty ?? 0;
  let sum = 0;
  for (const b of batches) {
    if (!isExpired(b, asOf) || includeExpiredBatchIds?.has(b.id)) sum += b.qty;
  }
  return sum;
}

// Total quantity across all batches (expired included) — the material's
// headline stock. Falls back to `stockQty` when there are no batches.
export function totalStockQty(
  rm: Pick<RawMaterial, 'stockQty' | 'stockBatches'>,
): number {
  const batches = rm.stockBatches;
  if (!batches || batches.length === 0) return rm.stockQty ?? 0;
  return batches.reduce((s, b) => s + b.qty, 0);
}

// The material's worst (soonest) effective expiry across its batches — used to
// drive the catalog "closest expiry" filters. Undefined when nothing expires.
export function soonestExpiry(
  rm: Pick<RawMaterial, 'stockBatches'>,
  asOf: Date = new Date(),
): { batch: StockBatch; status: ExpiryStatus; days: number } | undefined {
  let best: { batch: StockBatch; days: number } | undefined;
  for (const b of rm.stockBatches ?? []) {
    const days = daysUntilExpiry(b, asOf);
    if (days === undefined) continue;
    if (!best || days < best.days) best = { batch: b, days };
  }
  if (!best) return undefined;
  const status: ExpiryStatus = best.days < 0 ? 'expired' : 'ok';
  return { batch: best.batch, status, days: best.days };
}

// Convenience: does this material have any batch expired as of `asOf`?
export function hasExpiredBatch(
  rm: Pick<RawMaterial, 'stockBatches'>,
  asOf: Date = new Date(),
): boolean {
  return (rm.stockBatches ?? []).some((b) => isExpired(b, asOf));
}

// Build the calculation-facing references for a material's expired batches, so
// a calculator can surface them for the per-run "count as valid?" decision.
// `includeExpiredBatchIds` marks which were counted in the current run.
export function collectExpiredRefs(
  rm: RawMaterial,
  asOf: Date = new Date(),
  includeExpiredBatchIds?: Set<string>,
): ExpiredBatchRef[] {
  const refs: ExpiredBatchRef[] = [];
  for (const b of rm.stockBatches ?? []) {
    if (!isExpired(b, asOf)) continue;
    refs.push({
      rawMaterialId: rm.id,
      rawMaterialName: rm.name,
      batchId: b.id,
      qty: b.qty,
      unit: rm.unit,
      originalExpiry: b.expiryDate,
      effectiveExpiry: effectiveExpiry(b),
      note: b.note,
      included: includeExpiredBatchIds?.has(b.id) ?? false,
    });
  }
  return refs;
}

// Expiry summary for a material's stock as counted in a calculation: the
// soonest effective expiry among the batches that count as available, and the
// total quantity excluded because it is expired (and not opted back in).
export function expirySummary(
  rm: Pick<RawMaterial, 'stockBatches'>,
  asOf: Date = new Date(),
  includeExpiredBatchIds?: Set<string>,
): { nextExpiry?: string; expiredExcludedQty: number } {
  let nextExpiry: string | undefined;
  let expiredExcludedQty = 0;
  for (const b of rm.stockBatches ?? []) {
    const counted = !isExpired(b, asOf) || includeExpiredBatchIds?.has(b.id);
    if (!counted) {
      expiredExcludedQty += b.qty;
      continue;
    }
    const eff = effectiveExpiry(b);
    if (eff && (!nextExpiry || eff < nextExpiry)) nextExpiry = eff;
  }
  return { nextExpiry, expiredExcludedQty };
}

// The unit used to display a material's batch quantities. Purely a passthrough
// today, kept so callers don't import Unit just for annotations.
export function materialUnit(rm: Pick<RawMaterial, 'unit'>): Unit {
  return (rm as RawMaterial).unit;
}
