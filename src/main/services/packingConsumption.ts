// Shared math for the packingScheme model.
//
// Per tier, a finished product (or kg of bulk) consumes `tier.consumption` of
// the referenced component's capacity-unit. The component itself owns the
// total capacity of one of its pieces. Cross-packaging dependencies — set on
// a component, not on a product tier — cascade through transitively (e.g.
// carton consumes tape, barrel consumes bag).
//
// Two walks:
//   walkSchemePerProduct(product, components)
//     Returns units consumed per 1 finished product unit. For per_unit tiers
//     this is `tier.consumption` (or auto-derived for kg/l). For per_bulk_mass
//     tiers this scales by the per-product mass/volume in the component's
//     capacity-unit. Used by cost calculator and the "items" branch of the
//     shortage calculator.
//
//   walkSchemePerBulkKg(product, components)
//     Returns units consumed per 1 kg of bulk mass. Only per_bulk_mass tiers
//     contribute; per_unit tiers return 0 here (cartons don't matter for bulk
//     production). Used by the "bulkMass" branch of the shortage calculator.

import type {
  PackagingComponent,
  PackingTier,
  Product,
  UUID,
} from '../../shared/types';

// Per-product mass/volume in the component's capacity-unit. Used for both
// per_unit + kg/l auto-derive and for per_bulk_mass scaling on the items
// branch (each finished product carries its own mass through the bulk
// container).
function productAmountInUnit(
  product: Product,
  unit: PackagingComponent['capacityUnit'],
): number {
  if (unit === 'kg') return (product.capacityMl * product.densityGPerMl) / 1000;
  if (unit === 'l') return product.capacityMl / 1000;
  return 1;
}

// Bulk amount (1 kg) expressed in the component's capacity-unit. For 'kg' →
// 1. For 'l' → 1/density (1 kg of mass occupies 1/density liters). For
// 'units'/'m' → 0 (per_bulk_mass with these units is nonsense).
function bulkKgInUnit(
  product: Product,
  unit: PackagingComponent['capacityUnit'],
): number {
  if (unit === 'kg') return 1;
  if (unit === 'l') {
    const d = product.densityGPerMl;
    if (!d || d <= 0) return 0;
    // mass_kg → volume_l: mass_kg / density_g_per_ml (= /1000 then *1000)
    return 1 / d;
  }
  return 0;
}

function tierConsumptionPerProduct(
  product: Product,
  tier: PackingTier,
  comp: PackagingComponent,
): number {
  const unit = comp.capacityUnit ?? 'units';
  const scope = tier.scope ?? 'per_unit';

  if (scope === 'per_bulk_mass') {
    // Per-product share of the bulk consumed: each finished product carries
    // its own mass through the bulk container, so a barrel "amortizes" by
    // (product mass in barrel's unit) × tier.consumption.
    return productAmountInUnit(product, unit) * tier.consumption;
  }
  // per_unit. For kg/l auto-derive unless the user opted into manual.
  if ((unit === 'kg' || unit === 'l') && !tier.consumptionOverride) {
    return productAmountInUnit(product, unit);
  }
  return tier.consumption;
}

function tierConsumptionPerBulkKg(
  product: Product,
  tier: PackingTier,
  comp: PackagingComponent,
): number {
  if ((tier.scope ?? 'per_unit') !== 'per_bulk_mass') return 0;
  const unit = comp.capacityUnit ?? 'units';
  return bulkKgInUnit(product, unit) * tier.consumption;
}

// Generic cascade — visits every component reachable from the tier set,
// summing how much of each is consumed per (whatever scope `seed` provides).
function walk(
  product: Product,
  componentsById: Map<UUID, PackagingComponent>,
  seed: (tier: PackingTier, comp: PackagingComponent) => number,
): Array<{ componentId: UUID; unitsConsumedPerProduct: number }> {
  const out = new Map<UUID, number>();
  const tiers = product.packingScheme?.tiers ?? [];

  const visit = (
    componentId: UUID,
    unitsConsumedHere: number,
    seen: Set<UUID>,
  ) => {
    if (seen.has(componentId)) return;
    seen.add(componentId);
    const comp = componentsById.get(componentId);
    if (!comp) return;
    out.set(componentId, (out.get(componentId) ?? 0) + unitsConsumedHere);
    // Cascade: 1 of this component pulls `dep.consumption` units of the
    // dependent (in the dependent's capacity-unit). Scale by how many pieces
    // of *this* component are consumed (units / capacity).
    if (!comp.capacity || comp.capacity <= 0) return;
    const piecesOfThisPerScopeUnit = unitsConsumedHere / comp.capacity;
    for (const dep of comp.dependencies ?? []) {
      const depUnits = piecesOfThisPerScopeUnit * dep.consumption;
      visit(dep.componentId, depUnits, new Set(seen));
    }
  };

  for (const tier of tiers) {
    const comp = componentsById.get(tier.componentId);
    if (!comp) continue;
    const consumption = seed(tier, comp);
    if (consumption <= 0) continue;
    visit(tier.componentId, consumption, new Set());
  }

  return Array.from(out.entries()).map(([componentId, unitsConsumedPerProduct]) => ({
    componentId,
    unitsConsumedPerProduct,
  }));
}

// Per finished product unit. Covers per_unit tiers + per_bulk_mass tiers
// (scaled by per-product mass/volume so finished-product cost / shortage
// still accounts for shared bulk packaging).
export function walkSchemePerProduct(
  product: Product,
  componentsById: Map<UUID, PackagingComponent>,
): Array<{ componentId: UUID; unitsConsumedPerProduct: number }> {
  return walk(product, componentsById, (tier, comp) =>
    tierConsumptionPerProduct(product, tier, comp),
  );
}

// Per 1 kg of bulk mass. Only per_bulk_mass tiers contribute; useful for the
// bulkMass branch of the shortage calculator (bulk-only production runs).
export function walkSchemePerBulkKg(
  product: Product,
  componentsById: Map<UUID, PackagingComponent>,
): Array<{ componentId: UUID; unitsConsumedPerProduct: number }> {
  return walk(product, componentsById, (tier, comp) =>
    tierConsumptionPerBulkKg(product, tier, comp),
  );
}

export function piecesPerProduct(
  comp: PackagingComponent,
  unitsConsumedPerProduct: number,
): number {
  if (!comp.capacity || comp.capacity <= 0) return 0;
  return unitsConsumedPerProduct / comp.capacity;
}

// Helper exposed for the editor preview only — same math the calculators use.
export function tierConsumptionPerProductPublic(
  product: Product,
  tier: PackingTier,
  comp: PackagingComponent,
): number {
  return tierConsumptionPerProduct(product, tier, comp);
}
