// Shared math for the packingScheme model.
//
// Per tier, a finished product (or kg of bulk) consumes `tier.consumption` of
// the referenced component's capacity-unit. The component itself owns the
// total capacity of one of its pieces. Cross-packaging dependencies — set on
// a component, not on a product tier — cascade through transitively (e.g.
// carton consumes tape, barrel consumes bag).
//
// Which production type a tier binds to is decided by the component's
// packagingKind ('product' → finished units, 'mass' → bulk kg), not by the
// legacy tier-level scope.
//
// Two fractional walks (per-unit SHARES — cost drill-down, reverse bounds):
//   walkSchemePerProduct(product, components)
//     Capacity-units consumed per 1 finished product unit, 'product'-kind
//     tiers only ('units' → 1 slot; kg/l auto-derived from the product's
//     mass/volume unless overridden; 'm' → tier.consumption).
//
//   walkSchemePerBulkKg(product, components)
//     Capacity-units consumed per 1 kg of bulk mass, 'mass'-kind tiers only.
//
// Whole-piece demand (what a plan actually needs — shortage, cost total,
// max-producible): schemeDemand(runs, components, overageFactor). Containers
// (direct tiers in units/kg/l) are rounded per product with the overage inside
// the ceil; consumables (direct 'm' tiers and every cascade dependency) are
// derived from the whole containers, summed plan-wide and rounded once.

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
    // e.g. 1 carton × 0.3 m of tape → 0.3 m, not a whole roll. A parent
    // without capacity cuts its cascade off here; schemeDemand reports it.
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

// 'product'-kind packaging binds to finished-unit production, 'mass'-kind to
// bulk-mass production (see tierConsumptionPerProduct / PerBulkKg).
export function isProductKindPackaging(comp: PackagingComponent): boolean {
  return (comp.packagingKind ?? 'product') === 'product';
}

// Whole-piece rounding with a float guard: an exact multiple accumulated as
// fractions (24 × 1/24) can land at 1.0000000000000002 — without the epsilon
// that would ceil to a phantom extra piece.
export function ceilPieces(pieces: number): number {
  return Math.ceil(pieces - 1e-9);
}

// ---- Whole-piece scheme demand ----
//
// One production run of a product inside a plan: finished units (items
// branch) and/or kg of bulk mass (bulkMass branch). `product` must already
// carry any per-run substitution (substituteProductScheme).
export interface SchemeRun {
  product: Product;
  units: number;
  bulkKg: number;
}

export interface SchemeNeed {
  // Whole pieces to have in stock, the component's overage included.
  pieces: number;
  // Reached as a direct scheme tier / through another component's
  // 'dependencies' ("zużywa") — both can be true.
  direct: boolean;
  cascade: boolean;
}

// Consumables are measured in metres (tape) — they are cut, not filled, so
// several cartons (and several products) draw from the same roll. Everything
// else (slots, kg, l) is a container a product fills on its own.
function isConsumable(comp: PackagingComponent): boolean {
  return comp.capacityUnit === 'm';
}

// Plan-level demand for packing-scheme components. Rules:
//   - containers (direct tiers in units/kg/l): products never share a piece,
//     so per (product, component) pieces = ceil(fraction × overage) — one
//     rounding, overage inside the ceil;
//   - consumables (direct 'm' tiers + every cascade dependency): capacity-
//     units summed across the whole plan, then ceil(units / capacity ×
//     overage) once;
//   - cascade dependencies are derived from the WHOLE containers actually
//     used (bare count, before the parent's overage — the spare cartons are
//     not taped unless used, and the tape's own overage covers its waste);
//     deeper levels scale proportionally.
// Anything the math has to skip (no capacity, zero consumption, a capacity
// unit a tier can't use, a missing component) is returned as a Polish warning
// naming the component and the product.
export function schemeDemand(
  runs: SchemeRun[],
  componentsById: Map<UUID, PackagingComponent>,
  overageFactor: (comp: PackagingComponent) => number,
): { needs: Map<UUID, SchemeNeed>; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };
  const needs = new Map<UUID, SchemeNeed>();
  const need = (componentId: UUID): SchemeNeed => {
    let n = needs.get(componentId);
    if (!n) {
      n = { pieces: 0, direct: false, cascade: false };
      needs.set(componentId, n);
    }
    return n;
  };
  // productId → componentId → fractional container pieces.
  const containers = new Map<UUID, { product: Product; pieces: Map<UUID, number> }>();
  // componentId → capacity-units of consumables, plan-wide.
  const consumables = new Map<UUID, number>();
  const addConsumable = (componentId: UUID, units: number) =>
    consumables.set(componentId, (consumables.get(componentId) ?? 0) + units);

  // Pull a parent's 'dependencies' in for `parentPieces` pieces of it.
  const cascade = (
    product: Product,
    parent: PackagingComponent,
    parentPieces: number,
    seen: Set<UUID>,
  ) => {
    for (const dep of parent.dependencies ?? []) {
      if (seen.has(dep.componentId)) continue;
      const child = componentsById.get(dep.componentId);
      if (!child) {
        warn(
          `Komponent „${parent.name}" zużywa nieistniejący komponent (${dep.componentId}) — pominięto w obliczeniach.`,
        );
        continue;
      }
      if (!(dep.consumption > 0)) {
        warn(
          `Zależność „${parent.name}" → „${child.name}" (produkt „${product.name}") ma zużycie 0 — pominięto w obliczeniach.`,
        );
        continue;
      }
      if (!child.capacity || child.capacity <= 0) {
        warn(
          `Komponent „${child.name}" (zużywany przez „${parent.name}", produkt „${product.name}") nie ma ustawionej pojemności — pominięto w obliczeniach.`,
        );
        continue;
      }
      const units = parentPieces * dep.consumption;
      need(child.id).cascade = true;
      addConsumable(child.id, units);
      cascade(product, child, units / child.capacity, new Set(seen).add(child.id));
    }
  };

  for (const run of runs) {
    const { product } = run;
    for (const tier of product.packingScheme?.tiers ?? []) {
      const comp = componentsById.get(tier.componentId);
      if (!comp) {
        warn(
          `Schemat produktu „${product.name}" wskazuje na nieistniejący komponent (${tier.componentId}) — pominięto w obliczeniach.`,
        );
        continue;
      }
      // The branch the component binds to — the other one is 0 by design.
      const isMass = (comp.packagingKind ?? 'product') === 'mass';
      const scopeQty = isMass ? run.bulkKg : run.units;
      if (!(scopeQty > 0)) continue;
      const unit = comp.capacityUnit ?? 'units';
      const perScope = isMass
        ? tierConsumptionPerBulkKg(product, tier, comp)
        : tierConsumptionPerProduct(product, tier, comp);
      if (!Number.isFinite(perScope) || perScope <= 0) {
        if (isMass && unit !== 'kg' && unit !== 'l') {
          warn(
            `Opakowanie na masę „${comp.name}" (produkt „${product.name}") ma pojemność w jednostce „${unit}" — zużycia na kg masy nie da się policzyć (potrzebne kg lub l); pominięto w obliczeniach.`,
          );
        } else if (isMass && unit === 'l' && !(product.densityGPerMl > 0)) {
          warn(
            `Produkt „${product.name}" nie ma gęstości — nie da się przeliczyć masy na litry opakowania „${comp.name}"; pominięto w obliczeniach.`,
          );
        } else {
          warn(
            `Poziom schematu „${comp.name}" w produkcie „${product.name}" ma zużycie 0 — pominięto w obliczeniach.`,
          );
        }
        continue;
      }
      if (!comp.capacity || comp.capacity <= 0) {
        const deps = (comp.dependencies ?? [])
          .map((d) => componentsById.get(d.componentId)?.name)
          .filter((n): n is string => !!n);
        warn(
          `Opakowanie zbiorcze „${comp.name}" w schemacie produktu „${product.name}" nie ma ustawionej pojemności — pominięto je w obliczeniach${
            deps.length ? ` (razem z tym, co zużywa: ${deps.map((n) => `„${n}"`).join(', ')})` : ''
          }.`,
        );
        continue;
      }
      need(comp.id).direct = true;
      const units = perScope * scopeQty;
      if (isConsumable(comp)) {
        addConsumable(comp.id, units);
        cascade(product, comp, units / comp.capacity, new Set([comp.id]));
        continue;
      }
      let entry = containers.get(product.id);
      if (!entry) {
        entry = { product, pieces: new Map() };
        containers.set(product.id, entry);
      }
      entry.pieces.set(comp.id, (entry.pieces.get(comp.id) ?? 0) + units / comp.capacity);
    }
  }

  for (const { product, pieces: perComp } of containers.values()) {
    for (const [componentId, fraction] of perComp) {
      const comp = componentsById.get(componentId)!;
      need(componentId).pieces += ceilPieces(fraction * overageFactor(comp));
      cascade(product, comp, ceilPieces(fraction), new Set([componentId]));
    }
  }
  for (const [componentId, units] of consumables) {
    const comp = componentsById.get(componentId)!;
    // Capacity checked when the units were added.
    need(componentId).pieces += ceilPieces((units / comp.capacity!) * overageFactor(comp));
  }

  return { needs, warnings };
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
