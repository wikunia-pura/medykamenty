import type Database from '../database';
import type {
  ProductionPlan,
  ShortageReport,
  ShortageLine,
  ShortageGroup,
  Supplier,
  RawMaterial,
  PackagingComponent,
  ExpiredBatchRef,
} from '../../shared/types';
import { ceilToMoq, toGrams } from '../utils/units';
import { nowIso } from '../utils/id';
import { effectiveOverageFactor } from '../../shared/overage';
import { availableStockQty, collectExpiredRefs } from '../../shared/expiry';
import {
  walkSchemePerProduct,
  walkSchemePerBulkKg,
  piecesPerProduct,
} from './packingConsumption';

export async function computeShortages(
  planId: string,
  db: Database,
  // Expired batches the user chose to count as available for this run (per-run
  // decision — see the expired-stock prompt). Absent → all expired excluded.
  includeExpiredBatchIds: string[] = [],
): Promise<ShortageReport> {
  const plan = await db.getPlan(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const settings = db.getSettings();
  const asOf = new Date();
  const includeSet = new Set(includeExpiredBatchIds);
  // Overage ("naddatek") is now per-item: the bare requirement is accumulated
  // here factor-free, then each raw material / component's effective overage is
  // applied once when its shortage line is built (see below).
  const products = new Map((await db.listProducts()).map((p) => [p.id, p]));
  const rawMaterials = new Map((await db.listRawMaterials()).map((r) => [r.id, r]));
  const components = new Map((await db.listComponents()).map((c) => [c.id, c]));
  const suppliers = new Map((await db.listSuppliers()).map((s) => [s.id, s]));

  // Stock is now sourced from the catalog itself (raw_materials.stockQty /
  // components.stockQty), kept up to date by stock imports + manual edits via
  // services/stockReconciler.ts — so manual corrections feed straight into
  // shortage planning.
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
      const totalMassG = massPerUnitG * item.qtyUnits;
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
      // Scheme tiers + cascaded dependencies (carton → tape, barrel → bag).
      // walkSchemePerProduct gives per-finished-unit consumption in the
      // dependent component's capacity-unit. Includes per_bulk_mass tiers
      // scaled by per-product mass/volume — so finished-product runs still
      // account for shared bulk packaging (barrels, bags).
      for (const entry of walkSchemePerProduct(product, components)) {
        const comp = components.get(entry.componentId);
        if (!comp || !comp.capacity || comp.capacity <= 0) continue;
        const piecesPerUnit = piecesPerProduct(comp, entry.unitsConsumedPerProduct);
        if (!Number.isFinite(piecesPerUnit) || piecesPerUnit <= 0) continue;
        compNeedUnits.set(
          entry.componentId,
          (compNeedUnits.get(entry.componentId) ?? 0) + Math.ceil(piecesPerUnit * item.qtyUnits),
        );
      }
    }
    for (const bm of plan.bulkMass) {
      const product = products.get(bm.productId);
      if (!product) {
        warnings.push(`Bulk mass references missing product ${bm.productId}`);
        continue;
      }
      const totalMassG = bm.massKg * 1000;
      for (const ing of product.ingredients) {
        rawNeedG.set(
          ing.rawMaterialId,
          (rawNeedG.get(ing.rawMaterialId) ?? 0) + totalMassG * (ing.percentage / 100),
        );
      }
      // Bulk-only production also consumes per_bulk_mass scheme tiers — a
      // barrel still has to hold the bulk even if it never becomes finished
      // units. Per_unit tiers (cartons etc.) contribute 0 here.
      for (const entry of walkSchemePerBulkKg(product, components)) {
        const comp = components.get(entry.componentId);
        if (!comp || !comp.capacity || comp.capacity <= 0) continue;
        const piecesPerKg = piecesPerProduct(comp, entry.unitsConsumedPerProduct);
        if (!Number.isFinite(piecesPerKg) || piecesPerKg <= 0) continue;
        compNeedUnits.set(
          entry.componentId,
          (compNeedUnits.get(entry.componentId) ?? 0) + Math.ceil(piecesPerKg * bm.massKg),
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

    // Apply this raw material's effective overage ("naddatek") to the bare
    // requirement accumulated above.
    const neededWithOverageG =
      neededG * effectiveOverageFactor(rm.overagePct, settings.defaultOveragePctRaw);

    let availableG: number;
    try {
      // Expiry-aware: expired batches are excluded unless the user opted to
      // count them for this run. Batch-less materials use their flat stockQty.
      const stockQty = availableStockQty(rm, asOf, includeSet);
      availableG = toGrams(stockQty, rm.unit);
    } catch (err) {
      warnings.push(
        `Cannot compute available stock for ${rm.name} (unit ${rm.unit}): ${(err as Error).message}`,
      );
      availableG = 0;
    }

    const shortageG = Math.max(0, neededWithOverageG - availableG);
    const suggestedOrder = ceilToMoq(shortageG / 1000, rm.moq); // expressed in same unit as MOQ (kg)

    rawLines.push({
      itemId: id,
      itemName: rm.name,
      itemKind: 'raw',
      unit: 'kg',
      required: neededWithOverageG / 1000,
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
    // Apply this component's effective overage ("naddatek"), then round up —
    // components are whole pieces.
    const neededWithOverage = Math.ceil(
      neededUnits * effectiveOverageFactor(comp.overagePct, settings.defaultOveragePctComponent),
    );
    const available = comp.stockQty ?? 0;
    const shortage = Math.max(0, neededWithOverage - available);
    const suggestedOrder = ceilToMoq(shortage, comp.moq);
    componentLines.push({
      itemId: id,
      itemName: comp.name,
      itemKind: 'component',
      unit: 'pcs',
      required: neededWithOverage,
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

  // Surface expired batches among the plan's (non factory-supplied) materials so
  // the caller can prompt the user to include/exclude them for this run.
  const expiredBatches: ExpiredBatchRef[] = [];
  for (const id of rawNeedG.keys()) {
    const rm = rawMaterials.get(id);
    if (!rm || rm.factorySupplied) continue;
    expiredBatches.push(...collectExpiredRefs(rm, asOf, includeSet));
  }

  return {
    planId,
    computedAt: nowIso(),
    rawLines,
    componentLines,
    groups,
    warnings,
    expiredBatches,
  };
}

// Lightweight pre-pass for the expired-stock prompt: which expired raw-material
// batches are relevant to this plan (its products' non factory-supplied
// ingredients), without running the full shortage computation or saving a
// report. The caller shows these, collects the user's include/exclude decision,
// then calls computeShortages with the chosen batch ids.
export async function previewExpiredForPlan(
  planId: string,
  db: Database,
): Promise<ExpiredBatchRef[]> {
  const plan = await db.getPlan(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  const products = new Map((await db.listProducts()).map((p) => [p.id, p]));
  const rawMaterials = new Map((await db.listRawMaterials()).map((r) => [r.id, r]));
  const asOf = new Date();
  const seen = new Set<string>();
  const refs: ExpiredBatchRef[] = [];
  const addForProduct = (productId: string) => {
    const product = products.get(productId);
    if (!product) return;
    for (const ing of product.ingredients) {
      if (seen.has(ing.rawMaterialId)) continue;
      seen.add(ing.rawMaterialId);
      const rm = rawMaterials.get(ing.rawMaterialId);
      if (!rm || rm.factorySupplied) continue;
      refs.push(...collectExpiredRefs(rm, asOf));
    }
  };
  for (const item of plan.items) addForProduct(item.productId);
  for (const bm of plan.bulkMass) addForProduct(bm.productId);
  return refs;
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
