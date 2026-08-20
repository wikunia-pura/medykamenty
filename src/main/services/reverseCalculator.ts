import type Database from '../database';
import type {
  MaxProducibleResult,
  PackagingComponent,
  ExpiredBatchRef,
  DependencyShortageRef,
} from '../../shared/types';
import { toGrams } from '../utils/units';
import {
  walkSchemePerProduct,
  piecesPerProduct,
  substituteProductScheme,
  substituteComponentDependencies,
  type PackingSubstitutions,
} from './packingConsumption';
import { effectiveOverageFactor } from '../../shared/overage';
import { availableStockQty, collectExpiredRefs, expirySummary } from '../../shared/expiry';

export async function maxProducible(
  productId: string,
  db: Database,
  // Expired batches the user chose to count as available for this run (per-run
  // decision). Absent → all expired excluded.
  includeExpiredBatchIds: string[] = [],
  // Scheme-derived components whose shortage the user accepted for this run
  // (a substitute exists) — they are excluded from the bottleneck list.
  acceptedDependencyIds: string[] = [],
  // Per-run packaging swaps ("podmiana"): originalComponentId → substituteId.
  substitutions: PackingSubstitutions = {},
): Promise<MaxProducibleResult> {
  const product = await db.getProduct(productId);
  if (!product) throw new Error(`Product ${productId} not found`);

  const settings = db.getSettings();
  const asOf = new Date();
  const includeSet = new Set(includeExpiredBatchIds);

  const massPerUnitG = product.capacityMl * product.densityGPerMl;
  const bottlenecks: MaxProducibleResult['bottlenecks'] = [];
  const expiredBatches: ExpiredBatchRef[] = [];

  for (const ing of product.ingredients) {
    const rm = await db.getRawMaterial(ing.rawMaterialId);
    if (!rm) continue;
    if (rm.factorySupplied) continue;
    expiredBatches.push(...collectExpiredRefs(rm, asOf, includeSet));
    const gPerUnit =
      massPerUnitG *
      (ing.percentage / 100) *
      effectiveOverageFactor(rm.overagePct, settings.defaultOveragePctRaw);
    if (gPerUnit <= 0) continue;
    let availableG = 0;
    try {
      // Stock is sourced from the catalog and is expiry-aware: expired batches
      // are excluded unless the user counted them for this run.
      availableG = toGrams(availableStockQty(rm, asOf, includeSet), rm.unit);
    } catch {
      continue;
    }
    const { nextExpiry, expiredExcludedQty } = expirySummary(rm, asOf, includeSet);
    bottlenecks.push({
      itemId: rm.id,
      itemName: rm.name,
      kind: 'raw',
      available: availableG / 1000,
      needPerUnit: gPerUnit / 1000,
      maxUnits: Math.floor(availableG / gPerUnit),
      nextExpiry,
      expiredExcludedQty: expiredExcludedQty > 0 ? expiredExcludedQty : undefined,
    });
  }

  for (const pkg of product.packaging) {
    const comp = await db.getComponent(pkg.componentId);
    if (!comp) continue;
    if (pkg.qtyPerUnit <= 0) continue;
    const available = comp.stockQty ?? 0;
    const needPerUnit =
      pkg.qtyPerUnit *
      effectiveOverageFactor(comp.overagePct, settings.defaultOveragePctComponent);
    bottlenecks.push({
      itemId: comp.id,
      itemName: comp.name,
      kind: 'component',
      available,
      needPerUnit,
      maxUnits: Math.floor(available / needPerUnit),
    });
  }

  // Scheme tiers + cascaded dependencies. Each entry: how many of this
  // component's capacity-units are consumed per finished product. Pieces per
  // product = unitsConsumed / capacity. Max units = floor(available / pieces).
  const allComponents = await db.listComponents();
  // Per-run substitutions rewrite scheme tiers and 'dependencies' edges before
  // any math — downstream everything is the substitute.
  const compById = substituteComponentDependencies(
    new Map<string, PackagingComponent>(allComponents.map((c) => [c.id, c])),
    substitutions,
  );
  const acceptedSet = new Set(acceptedDependencyIds);
  const walkEntries = walkSchemePerProduct(
    substituteProductScheme(product, substitutions),
    compById,
  );
  const walkIds = new Set(walkEntries.map((e) => e.componentId));
  // Every scheme-derived bottleneck (direct tier or cascade) may be accepted /
  // substituted per run — track which bottleneck ids came from the scheme.
  const schemeIds = new Set<string>();
  const consumedByNames = (depId: string): string[] => {
    const names: string[] = [];
    for (const id of walkIds) {
      const parent = compById.get(id);
      if (parent?.dependencies?.some((d) => d.componentId === depId)) names.push(parent.name);
    }
    return names;
  };
  const dependencyShortages: DependencyShortageRef[] = [];
  for (const entry of walkEntries) {
    const comp = compById.get(entry.componentId);
    if (!comp) continue;
    const piecesRaw = piecesPerProduct(comp, entry.unitsConsumedPerProduct);
    if (!Number.isFinite(piecesRaw) || piecesRaw <= 0) continue;
    const pieces =
      piecesRaw *
      effectiveOverageFactor(comp.overagePct, settings.defaultOveragePctComponent);
    const available = comp.stockQty ?? 0;
    // Accepted shortage: a substitute will be used — the component does not
    // limit production and is left out of the bottleneck list.
    if (acceptedSet.has(comp.id)) {
      dependencyShortages.push({
        componentId: comp.id,
        componentName: comp.name,
        origin: entry.viaDependency ? 'cascade' : 'tier',
        consumedBy: consumedByNames(comp.id),
        available,
        maxUnits: Math.floor(available / pieces),
        accepted: true,
      });
      continue;
    }
    schemeIds.add(comp.id);
    bottlenecks.push({
      itemId: comp.id,
      itemName: comp.name,
      kind: 'component',
      available,
      needPerUnit: pieces,
      maxUnits: Math.floor(available / pieces),
      viaDependency: entry.viaDependency || undefined,
    });
  }

  bottlenecks.sort((a, b) => a.maxUnits - b.maxUnits);
  const units = bottlenecks.length ? bottlenecks[0].maxUnits : 0;

  // Scheme-derived bottlenecks that cap production below every non-scheme
  // limit (raw materials, primary packaging) — candidates for the per-run
  // accept/substitute prompt in the UI.
  const minNonScheme = Math.min(
    ...bottlenecks.filter((b) => !schemeIds.has(b.itemId)).map((b) => b.maxUnits),
  );
  for (const b of bottlenecks) {
    if (!schemeIds.has(b.itemId) || b.maxUnits >= minNonScheme) continue;
    dependencyShortages.push({
      componentId: b.itemId,
      componentName: b.itemName,
      origin: b.viaDependency ? 'cascade' : 'tier',
      consumedBy: consumedByNames(b.itemId),
      available: b.available,
      maxUnits: b.maxUnits,
      accepted: false,
    });
  }

  return {
    productId,
    productName: product.name,
    units,
    bottlenecks: bottlenecks.slice(0, 5),
    expiredBatches,
    dependencyShortages,
  };
}
