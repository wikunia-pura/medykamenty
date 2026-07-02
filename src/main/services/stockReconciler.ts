import type Database from '../database';
import type {
  StockSnapshot,
  StockKind,
  StockRow,
  StockConflict,
  RawMaterial,
  PackagingComponent,
} from '../../shared/types';
import { nowIso } from '../utils/id';

// Sums matched import rows per catalog item. A catalog entry can be matched by
// several rows (e.g. the same material across multiple warehouses), so we add
// them up — this is the value an import wants to write to the item's stock.
// Shared with shortageCalculator's stock lookup historically; kept here so both
// the reconciler and any caller agree on aggregation.
export function aggregateMatchedStock(
  snapshot: { rows: StockRow[] } | undefined,
  kind: StockKind,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!snapshot) return map;
  for (const row of snapshot.rows) {
    const id = kind === 'raw' ? row.matchedRawMaterialId : row.matchedComponentId;
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + (row.qty ?? 0));
  }
  return map;
}

// Float-tolerant equality — aggregated sums can carry tiny rounding error, and
// we don't want that to masquerade as a real stock disagreement.
function qtyEquals(a: number | undefined, b: number): boolean {
  return Math.abs((a ?? 0) - b) < 1e-6;
}

// Applies an import's stock to the catalog and returns the conflicts that need a
// user decision. Rules (confirmed with the user):
//   - item last set by import (or never set) → overwrite silently
//   - item manually edited, value matches import → leave as-is, no conflict
//   - item manually edited, value differs → DO NOT touch; raise a conflict
//   - item absent from the import → leave untouched
export async function reconcileStock(
  db: Database,
  snapshot: StockSnapshot,
  kind: StockKind,
  onlyItemId?: string,
): Promise<{ applied: number; conflicts: StockConflict[] }> {
  const imported = aggregateMatchedStock(snapshot, kind);
  if (imported.size === 0) return { applied: 0, conflicts: [] };

  const items =
    kind === 'raw' ? await db.listRawMaterials() : await db.listComponents();
  const byId = new Map<string, RawMaterial | PackagingComponent>(
    items.map(it => [it.id, it]),
  );

  const now = nowIso();
  const toApply: (RawMaterial | PackagingComponent)[] = [];
  const conflicts: StockConflict[] = [];

  for (const [itemId, importedQty] of imported) {
    if (onlyItemId && itemId !== onlyItemId) continue;
    const item = byId.get(itemId);
    if (!item) continue; // matched to a deleted catalog entry — skip

    if (item.stockSource === 'manual') {
      if (qtyEquals(item.stockQty, importedQty)) continue; // agrees → nothing to do
      conflicts.push({
        itemId,
        kind,
        name: item.name,
        currentQty: item.stockQty,
        currentUpdatedAt: item.stockUpdatedAt,
        importedQty,
        importSourceFile: snapshot.sourceFile,
        unit: kind === 'raw' ? (item as RawMaterial).unit : undefined,
      });
      continue;
    }

    // Last set by import (or never set) → overwrite silently.
    toApply.push({
      ...item,
      stockQty: importedQty,
      stockSource: 'import',
      stockSourceFile: snapshot.sourceFile,
      stockUpdatedAt: now,
      updatedAt: now,
    });
  }

  await db.applyStockBulk(kind, toApply);
  return { applied: toApply.length, conflicts };
}
