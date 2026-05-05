import type Database from '../database';
import type {
  ProductionPlan,
  ShortageReport,
  ShortageLine,
  ShortageGroup,
  Supplier,
  RawMaterial,
  PackagingComponent,
  StockRow,
} from '../../shared/types';
import { ceilToMoq, toGrams } from '../utils/units';
import { nowIso } from '../utils/id';

function buildStockIndex(
  snapshot: { rows: StockRow[] } | undefined,
  by: 'raw' | 'component',
): Map<string, number> {
  const map = new Map<string, number>();
  if (!snapshot) return map;
  for (const row of snapshot.rows) {
    const id = by === 'raw' ? row.matchedRawMaterialId : row.matchedComponentId;
    if (!id) continue;
    map.set(id, (map.get(id) ?? 0) + (row.qty ?? 0));
  }
  return map;
}

export function computeShortages(planId: string, db: Database): ShortageReport {
  const plan = db.getPlan(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const settings = db.getSettings();
  const W = settings.wasteFactor;
  const products = new Map(db.listProducts().map((p) => [p.id, p]));
  const rawMaterials = new Map(db.listRawMaterials().map((r) => [r.id, r]));
  const components = new Map(db.listComponents().map((c) => [c.id, c]));
  const suppliers = new Map(db.listSuppliers().map((s) => [s.id, s]));

  const rawSnapshot = db.getCurrentSnapshot('raw');
  const compSnapshot = db.getCurrentSnapshot('component');
  const rawStockKgIndex = buildStockIndex(rawSnapshot, 'raw');
  const compStockUnitsIndex = buildStockIndex(compSnapshot, 'component');

  const rawNeedG = new Map<string, number>();
  const compNeedUnits = new Map<string, number>();
  const warnings: string[] = [];

  const accumulate = (plan: ProductionPlan) => {
    for (const item of plan.items) {
      const product = products.get(item.productId);
      if (!product) {
        warnings.push(`Plan item references missing product ${item.productId}`);
        continue;
      }
      const massPerUnitG = product.capacityMl * product.densityGPerMl;
      const totalMassG = massPerUnitG * item.qtyUnits * W;
      for (const ing of product.ingredients) {
        rawNeedG.set(
          ing.rawMaterialId,
          (rawNeedG.get(ing.rawMaterialId) ?? 0) + totalMassG * (ing.percentage / 100),
        );
      }
      for (const pkg of product.packaging) {
        compNeedUnits.set(
          pkg.componentId,
          (compNeedUnits.get(pkg.componentId) ?? 0) + pkg.qtyPerUnit * item.qtyUnits,
        );
      }
    }
    for (const bm of plan.bulkMass) {
      const product = products.get(bm.productId);
      if (!product) {
        warnings.push(`Bulk mass references missing product ${bm.productId}`);
        continue;
      }
      const totalMassG = bm.massKg * 1000 * W;
      for (const ing of product.ingredients) {
        rawNeedG.set(
          ing.rawMaterialId,
          (rawNeedG.get(ing.rawMaterialId) ?? 0) + totalMassG * (ing.percentage / 100),
        );
      }
    }
  };

  accumulate(plan);

  const rawLines: ShortageLine[] = [];
  for (const [id, neededG] of rawNeedG.entries()) {
    const rm = rawMaterials.get(id);
    if (!rm) {
      warnings.push(`Recipe references missing raw material ${id}`);
      continue;
    }
    if (rm.factorySupplied) continue;

    let availableG: number;
    try {
      const stockQty = rawStockKgIndex.get(id) ?? 0;
      availableG = toGrams(stockQty, rm.unit);
    } catch (err) {
      warnings.push(
        `Cannot compute available stock for ${rm.name} (unit ${rm.unit}): ${(err as Error).message}`,
      );
      availableG = 0;
    }

    const shortageG = Math.max(0, neededG - availableG);
    const suggestedOrder = ceilToMoq(shortageG / 1000, rm.moq); // expressed in same unit as MOQ (kg)

    rawLines.push({
      itemId: id,
      itemName: rm.name,
      itemKind: 'raw',
      unit: 'kg',
      required: neededG / 1000,
      available: availableG / 1000,
      shortage: shortageG / 1000,
      moq: rm.moq,
      suggestedOrder,
      preferredSupplierId: rm.preferredSupplierId,
    });
  }

  const componentLines: ShortageLine[] = [];
  for (const [id, neededUnits] of compNeedUnits.entries()) {
    const comp = components.get(id);
    if (!comp) {
      warnings.push(`Recipe references missing component ${id}`);
      continue;
    }
    const available = compStockUnitsIndex.get(id) ?? 0;
    const shortage = Math.max(0, neededUnits - available);
    const suggestedOrder = ceilToMoq(shortage, comp.moq);
    componentLines.push({
      itemId: id,
      itemName: comp.name,
      itemKind: 'component',
      unit: 'pcs',
      required: neededUnits,
      available,
      shortage,
      moq: comp.moq,
      suggestedOrder,
      preferredSupplierId: comp.preferredSupplierId,
    });
  }

  const groups = groupBySupplier(rawLines, componentLines, rawMaterials, components, suppliers);

  rawLines.sort((a, b) => b.shortage - a.shortage || a.itemName.localeCompare(b.itemName));
  componentLines.sort((a, b) => b.shortage - a.shortage || a.itemName.localeCompare(b.itemName));

  return {
    planId,
    computedAt: nowIso(),
    rawLines,
    componentLines,
    groups,
    warnings,
  };
}

function groupBySupplier(
  rawLines: ShortageLine[],
  componentLines: ShortageLine[],
  _rawMap: Map<string, RawMaterial>,
  _compMap: Map<string, PackagingComponent>,
  suppliers: Map<string, Supplier>,
): ShortageGroup[] {
  const buckets = new Map<string, ShortageGroup>();

  const ensureBucket = (supplierId?: string) => {
    const key = supplierId ?? '__none__';
    let group = buckets.get(key);
    if (!group) {
      const supplier = supplierId ? suppliers.get(supplierId) : undefined;
      group = {
        supplierId,
        supplierName: supplier?.name ?? 'Bez przypisanego dostawcy',
        supplierEmail: supplier?.email,
        rawLines: [],
        componentLines: [],
      };
      buckets.set(key, group);
    }
    return group;
  };

  for (const line of rawLines) {
    if (line.shortage <= 0) continue;
    ensureBucket(line.preferredSupplierId).rawLines.push(line);
  }
  for (const line of componentLines) {
    if (line.shortage <= 0) continue;
    ensureBucket(line.preferredSupplierId).componentLines.push(line);
  }

  return Array.from(buckets.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName));
}
