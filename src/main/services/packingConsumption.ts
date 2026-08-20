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

// Which production type a tier binds to is decided by the component's
// "typ opakowania" (packagingKind), not by the legacy tier-level scope:
//   'product' — consumed by finished-unit production (plan items) only,
//   'mass'    — consumed by bulk-mass production (plan bulkMass) only.
function tierConsumptionPerProduct(
  product: Product,
  tier: PackingTier,
  comp: PackagingComponent,
): number {
  // Mass packaging never binds to finished-unit production.
  if ((comp.packagingKind ?? 'product') === 'mass') return 0;
  const unit = comp.capacityUnit ?? 'units';
  // A product always occupies exactly 1 slot ('units' capacity) — a carton
  // with capacity 24 fits 24 linked products, no per-product slot
  // definition. Stored consumption is ignored for 'units'.
  if (unit === 'units') return 1;
  // For kg/l auto-derive unless the user opted into manual.
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
  // Product packaging never binds to bulk-mass production.
  if ((comp.packagingKind ?? 'product') !== 'mass') return 0;
  const unit = comp.capacityUnit ?? 'units';
  return bulkKgInUnit(product, unit) * tier.consumption;
}

export interface SchemeWalkEntry {
  componentId: UUID;
  unitsConsumedPerProduct: number;
  // True when the component was reached ONLY through 'dependencies' edges
  // ("zużywa" — tape via carton), never as a direct scheme tier. Such
  // shortages can be accepted per run by the user (a substitute exists).
  viaDependency: boolean;
}

// Generic cascade — visits every component reachable from the tier set,
// summing how much of each is consumed per (whatever scope `seed` provides).
function walk(
  product: Product,
  componentsById: Map<UUID, PackagingComponent>,
  seed: (tier: PackingTier, comp: PackagingComponent) => number,
): SchemeWalkEntry[] {
  const out = new Map<UUID, number>();
  const direct = new Set<UUID>();
  const tiers = product.packingScheme?.tiers ?? [];

  const visit = (
    componentId: UUID,
    unitsConsumedHere: number,
    seen: Set<UUID>,
    isDirect: boolean,
  ) => {
    if (seen.has(componentId)) return;
    seen.add(componentId);
    const comp = componentsById.get(componentId);
    if (!comp) return;
    if (isDirect) direct.add(componentId);
    out.set(componentId, (out.get(componentId) ?? 0) + unitsConsumedHere);
    // Cascade: 1 of this component pulls `dep.consumption` units of the
    // dependent (in the dependent's capacity-unit). Scale by how many pieces
    // of *this* component are consumed (units / capacity) — proportional,
    // e.g. 1 carton × 0.3 m of tape → 0.3 m, not a whole roll.
    if (!comp.capacity || comp.capacity <= 0) return;
    const piecesOfThisPerScopeUnit = unitsConsumedHere / comp.capacity;
    for (const dep of comp.dependencies ?? []) {
      const depUnits = piecesOfThisPerScopeUnit * dep.consumption;
      visit(dep.componentId, depUnits, new Set(seen), false);
    }
  };

  for (const tier of tiers) {
    const comp = componentsById.get(tier.componentId);
    if (!comp) continue;
    const consumption = seed(tier, comp);
    if (consumption <= 0) continue;
    visit(tier.componentId, consumption, new Set(), true);
  }

  return Array.from(out.entries()).map(([componentId, unitsConsumedPerProduct]) => ({
    componentId,
    unitsConsumedPerProduct,
    viaDependency: !direct.has(componentId),
  }));
}

// Per finished product unit. Covers per_unit tiers + per_bulk_mass tiers
// (scaled by per-product mass/volume so finished-product cost / shortage
// still accounts for shared bulk packaging).
export function walkSchemePerProduct(
  product: Product,
  componentsById: Map<UUID, PackagingComponent>,
): SchemeWalkEntry[] {
  return walk(product, componentsById, (tier, comp) =>
    tierConsumptionPerProduct(product, tier, comp),
  );
}

// Per 1 kg of bulk mass. Only per_bulk_mass tiers contribute; useful for the
// bulkMass branch of the shortage calculator (bulk-only production runs).
export function walkSchemePerBulkKg(
  product: Product,
  componentsById: Map<UUID, PackagingComponent>,
): SchemeWalkEntry[] {
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

// 'product'-kind shared packaging is consumed fractionally per product
// (1/24 carton) and rounded up to whole pieces ONCE, on the plan total —
// 3 cartons + 15/24 in the last one → 4. 'mass'-kind keeps the legacy
// per-entry rounding until it gets its own model.
export function isProductKindPackaging(comp: PackagingComponent): boolean {
  return (comp.packagingKind ?? 'product') === 'product';
}

// Whole-piece rounding with a float guard: an exact multiple accumulated as
// fractions (24 × 1/24) can land at 1.0000000000000002 — without the epsilon
// that would ceil to a phantom extra piece.
export function ceilPieces(pieces: number): number {
  return Math.ceil(pieces - 1e-9);
}

// ---- Per-run packaging substitutions ("podmiana") ----
//
// The user can swap a missing shared-packaging component for another one for
// a single calculation run (barrel 120l → barrel 50l, tape A → tape B).
// Substitution is applied BEFORE the walks, in both places a component id can
// enter a calculation: a product's scheme tiers and other components'
// 'dependencies'. Everything downstream (capacity, stock, price, own
// cascade) is then genuinely the substitute's. Applied once — no chaining.

export type PackingSubstitutions = Record<UUID, UUID>;

export function substituteProductScheme(product: Product, subs: PackingSubstitutions): Product {
  const tiers = product.packingScheme?.tiers ?? [];
  if (tiers.length === 0 || !tiers.some((t) => subs[t.componentId])) return product;
  return {
    ...product,
    packingScheme: {
      tiers: tiers.map((t) =>
        subs[t.componentId] ? { ...t, componentId: subs[t.componentId] } : t,
      ),
    },
  };
}

export function substituteComponentDependencies(
  componentsById: Map<UUID, PackagingComponent>,
  subs: PackingSubstitutions,
): Map<UUID, PackagingComponent> {
  if (Object.keys(subs).length === 0) return componentsById;
  const next = new Map<UUID, PackagingComponent>();
  for (const [id, comp] of componentsById) {
    const deps = comp.dependencies ?? [];
    next.set(
      id,
      deps.some((d) => subs[d.componentId])
        ? {
            ...comp,
            dependencies: deps.map((d) =>
              subs[d.componentId] ? { ...d, componentId: subs[d.componentId] } : d,
            ),
          }
        : comp,
    );
  }
  return next;
}

// Helper exposed for the editor preview only — same math the calculators use.
export function tierConsumptionPerProductPublic(
  product: Product,
  tier: PackingTier,
  comp: PackagingComponent,
): number {
  return tierConsumptionPerProduct(product, tier, comp);
}
