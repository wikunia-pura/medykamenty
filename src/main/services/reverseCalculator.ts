import type Database from '../database';
import type { MaxProducibleResult, StockRow } from '../../shared/types';
import { toGrams } from '../utils/units';

function buildIndex(rows: StockRow[] | undefined, by: 'raw' | 'component'): Map<string, number> {
  const map = new Map<string, number>();
  if (!rows) return map;
  for (const r of rows) {
    const id = by === 'raw' ? r.matchedRawMaterialId : r.matchedComponentId;
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + (r.qty ?? 0));
  }
  return map;
}

export async function maxProducible(productId: string, db: Database): Promise<MaxProducibleResult> {
  const product = await db.getProduct(productId);
  if (!product) throw new Error(`Product ${productId} not found`);

  const settings = db.getSettings();
  const W = settings.wasteFactor;
  const rawSnapshot = await db.getCurrentSnapshot('raw');
  const compSnapshot = await db.getCurrentSnapshot('component');
  const rawIndex = buildIndex(rawSnapshot?.rows, 'raw');
  const compIndex = buildIndex(compSnapshot?.rows, 'component');

  const massPerUnitG = product.capacityMl * product.densityGPerMl;
  const bottlenecks: MaxProducibleResult['bottlenecks'] = [];

  for (const ing of product.ingredients) {
    const rm = await db.getRawMaterial(ing.rawMaterialId);
    if (!rm) continue;
    if (rm.factorySupplied) continue;
    const gPerUnit = massPerUnitG * (ing.percentage / 100) * W;
    if (gPerUnit <= 0) continue;
    let availableG = 0;
    try {
      availableG = toGrams(rawIndex.get(rm.id) ?? 0, rm.unit);
    } catch {
      continue;
    }
    bottlenecks.push({
      itemId: rm.id,
      itemName: rm.name,
      kind: 'raw',
      available: availableG / 1000,
      needPerUnit: gPerUnit / 1000,
      maxUnits: Math.floor(availableG / gPerUnit),
    });
  }

  for (const pkg of product.packaging) {
    const comp = await db.getComponent(pkg.componentId);
    if (!comp) continue;
    if (pkg.qtyPerUnit <= 0) continue;
    const available = compIndex.get(comp.id) ?? 0;
    bottlenecks.push({
      itemId: comp.id,
      itemName: comp.name,
      kind: 'component',
      available,
      needPerUnit: pkg.qtyPerUnit,
      maxUnits: Math.floor(available / pkg.qtyPerUnit),
    });
  }

  bottlenecks.sort((a, b) => a.maxUnits - b.maxUnits);
  const units = bottlenecks.length ? bottlenecks[0].maxUnits : 0;

  return {
    productId,
    productName: product.name,
    units,
    bottlenecks: bottlenecks.slice(0, 5),
  };
}
