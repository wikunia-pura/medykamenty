import type Database from '../database';
import type {
  MaxProducibleResult,
  PackagingComponent,
  ExpiredBatchRef,
  DependencyShortageRef,
} from '../../shared/types';
import { isMassUnit, toGrams } from '../utils/units';
import {
  walkSchemePerProduct,
  piecesPerProduct,
  schemeDemand,
  substituteProductScheme,
  substituteComponentDependencies,
  type PackingSubstitutions,
} from './packingConsumption';
import { effectiveOverageFactor } from '../../shared/overage';
import { availableStockQty, collectExpiredRefs, expirySummary } from '../../shared/expiry';

// Upper bound of the scheme search — far beyond any real stock.
const MAX_SEARCH_UNITS = 2 ** 40;

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
  // One read per table (each is a round trip), all in parallel — lookups below
  // go through Maps instead of a get per recipe line.
  const [product, rawList, componentList] = await Promise.all([
    db.getProduct(productId),
    db.listRawMaterials(),
    db.listComponents(),
  ]);
  if (!product) throw new Error(`Product ${productId} not found`);
  const rawById = new Map(rawList.map((r) => [r.id, r]));
  const baseComponents = new Map<string, PackagingComponent>(
    componentList.map((c) => [c.id, c]),
  );

  const settings = db.getSettings();
  const asOf = new Date();
  const includeSet = new Set(includeExpiredBatchIds);
  const compOverage = (comp: PackagingComponent) =>
    effectiveOverageFactor(comp.overagePct, settings.defaultOveragePctComponent);

  const massPerUnitG = product.capacityMl * product.densityGPerMl;
  const bottlenecks: MaxProducibleResult['bottlenecks'] = [];
  const expiredBatches: ExpiredBatchRef[] = [];
  const warnings: string[] = [];

  for (const ing of product.ingredients) {
    const rm = rawById.get(ing.rawMaterialId);
    if (!rm) {
      warnings.push(
        `Receptura wskazuje na nieistniejący surowiec (${ing.rawMaterialId}) — pominięto.`,
      );
      continue;
    }
    if (rm.factorySupplied) continue;
    expiredBatches.push(...collectExpiredRefs(rm, asOf, includeSet));
    const gPerUnit =
      massPerUnitG *
      (ing.percentage / 100) *
      effectiveOverageFactor(rm.overagePct, settings.defaultOveragePctRaw);
    if (gPerUnit <= 0) continue;
    // Stock is sourced from the catalog and is expiry-aware: expired batches
    // are excluded unless the user counted them for this run.
    const stockQty = availableStockQty(rm, asOf, includeSet);
    const { nextExpiry, expiredExcludedQty } = expirySummary(rm, asOf, includeSet);
    // Volume-unit material (l/ml): no density to compare the recipe mass with
    // the stock. Not dropped silently (that would overstate the result) —
    // it blocks production at 0 until checked by hand, like the shortage
    // report, which leaves it out with the same warning.
    if (!isMassUnit(rm.unit)) {
      warnings.push(
        `Surowiec „${rm.name}" ma jednostkę „${rm.unit}" — bez gęstości nie da się porównać zapotrzebowania (${(gPerUnit / 1000).toFixed(4)} kg na sztukę) ze stanem; wynik wstrzymany na 0, sprawdź ręcznie.`,
      );
      bottlenecks.push({
        itemId: rm.id,
        itemName: rm.name,
        kind: 'raw',
        available: stockQty,
        needPerUnit: gPerUnit / 1000,
        maxUnits: 0,
        nextExpiry,
        expiredExcludedQty: expiredExcludedQty > 0 ? expiredExcludedQty : undefined,
        unconvertibleUnit: rm.unit,
      });
      continue;
    }
    const availableG = toGrams(stockQty, rm.unit);
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
    const comp = baseComponents.get(pkg.componentId);
    if (!comp) {
      warnings.push(
        `Receptura wskazuje na nieistniejący komponent (${pkg.componentId}) — pominięto.`,
      );
      continue;
    }
    if (pkg.qtyPerUnit <= 0) continue;
    const available = comp.stockQty ?? 0;
    const needPerUnit = pkg.qtyPerUnit * compOverage(comp);
    bottlenecks.push({
      itemId: comp.id,
      itemName: comp.name,
      kind: 'component',
      available,
      needPerUnit,
      maxUnits: Math.floor(available / needPerUnit),
    });
  }

  // Scheme tiers + cascaded dependencies. The cap is the largest N for which
  // the shortage report's own whole-piece demand (schemeDemand — per-product
  // ceil with overage, cascades from whole cartons) fits the stock, so
  // "max N" here and "no shortage for N" there always agree. The demand is
  // monotonic in N, so a doubling + bisection search finds it.
  // Per-run substitutions rewrite scheme tiers and 'dependencies' edges before
  // any math — downstream everything is the substitute.
  const compById = substituteComponentDependencies(baseComponents, substitutions);
  const schemed = substituteProductScheme(product, substitutions);
  const demandAt = (n: number) =>
    schemeDemand([{ product: schemed, units: n, bulkKg: 0 }], compById, compOverage);
  const probe = demandAt(1);
  warnings.push(...probe.warnings);
  const maxUnitsWithin = (componentId: string, available: number): number => {
    const fits = (n: number) => (demandAt(n).needs.get(componentId)?.pieces ?? 0) <= available;
    if (!fits(1)) return 0;
    let lo = 1;
    let hi = 2;
    while (fits(hi)) {
      lo = hi;
      hi *= 2;
      if (hi > MAX_SEARCH_UNITS) return lo;
    }
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  // Fractional per-unit share (with overage) — shown as "need per unit".
  const shareById = new Map(
    walkSchemePerProduct(schemed, compById).map((e) => {
      const comp = compById.get(e.componentId);
      const pieces = comp ? piecesPerProduct(comp, e.unitsConsumedPerProduct) : 0;
      return [e.componentId, comp ? pieces * compOverage(comp) : 0];
    }),
  );
  const acceptedSet = new Set(acceptedDependencyIds);
  // Every scheme-derived bottleneck (direct tier or cascade) may be accepted /
  // substituted per run — track which bottleneck ids came from the scheme.
  const schemeIds = new Set<string>();
  const consumedByNames = (depId: string): string[] => {
    const names: string[] = [];
    for (const id of probe.needs.keys()) {
      const parent = compById.get(id);
      if (parent?.dependencies?.some((d) => d.componentId === depId)) names.push(parent.name);
    }
    return names;
  };
  const dependencyShortages: DependencyShortageRef[] = [];
  for (const [componentId, need] of probe.needs) {
    const comp = compById.get(componentId);
    if (!comp) continue;
    const available = comp.stockQty ?? 0;
    const maxUnits = maxUnitsWithin(componentId, available);
    const viaDependency = need.cascade && !need.direct;
    // Accepted shortage: a substitute will be used — the component does not
    // limit production and is left out of the bottleneck list.
    if (acceptedSet.has(comp.id)) {
      dependencyShortages.push({
        componentId: comp.id,
        componentName: comp.name,
        origin: viaDependency ? 'cascade' : 'tier',
        consumedBy: consumedByNames(comp.id),
        available,
        maxUnits,
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
      needPerUnit: shareById.get(componentId) ?? 0,
      maxUnits,
      viaDependency: viaDependency || undefined,
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
    warnings,
  };
}
