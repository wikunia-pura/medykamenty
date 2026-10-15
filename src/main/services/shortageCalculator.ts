import type Database from '../database';
import type {
  Product,
  ShortageReport,
  ShortageLine,
  ShortageGroup,
  Supplier,
  RawMaterial,
  PackagingComponent,
  ExpiredBatchRef,
  DependencyShortageRef,
} from '../../shared/types';
import { ceilToMoq, gramsTo, isMassUnit, toGrams } from '../utils/units';
import { nowIso } from '../utils/id';
import { effectiveOverageFactor } from '../../shared/overage';
import { availableStockQty, collectExpiredRefs } from '../../shared/expiry';
import {
  schemeDemand,
  ceilPieces,
  substituteProductScheme,
  substituteComponentDependencies,
  type PackingSubstitutions,
  type SchemeRun,
} from './packingConsumption';

export async function computeShortages(
  planId: string,
  db: Database,
  // Expired batches the user chose to count as available for this run (per-run
  // decision — see the expired-stock prompt). Absent → all expired excluded.
  includeExpiredBatchIds: string[] = [],
  // Scheme-derived components whose shortage the user accepted for this run
  // (a substitute exists) — their shortage lines are left out of the report.
  acceptedDependencyIds: string[] = [],
  // Per-run packaging swaps ("podmiana"): originalComponentId → substituteId.
  // Applied to scheme tiers and 'dependencies' before any math runs.
  substitutions: PackingSubstitutions = {},
): Promise<ShortageReport> {
  // Independent reads — each a round trip, so run them together.
  const [plan, productList, rawList, componentList, supplierList] = await Promise.all([
    db.getPlan(planId),
    db.listProducts(),
    db.listRawMaterials(),
    db.listComponents(),
    db.listSuppliers(),
  ]);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const settings = db.getSettings();
  const asOf = new Date();
  const includeSet = new Set(includeExpiredBatchIds);
  // Overage ("naddatek") is per-item: the bare requirement is accumulated
  // here factor-free, then each raw material / component's effective overage is
  // applied once when its shortage line is built (see below). Packing-scheme
  // pieces are the exception — schemeDemand applies the overage inside its
  // own whole-piece rounding.
  const products = new Map(productList.map((p) => [p.id, p]));
  const rawMaterials = new Map(rawList.map((r) => [r.id, r]));
  const baseComponents = new Map(componentList.map((c) => [c.id, c]));
  const suppliers = new Map(supplierList.map((s) => [s.id, s]));
  // Per-run substitutions rewrite the 'dependencies' edges here and the scheme
  // tiers per product below — downstream everything is the substitute.
  const components = substituteComponentDependencies(baseComponents, substitutions);
  const compOverage = (comp: PackagingComponent) =>
    effectiveOverageFactor(comp.overagePct, settings.defaultOveragePctComponent);

  // Stock is now sourced from the catalog itself (raw_materials.stockQty /
  // components.stockQty), kept up to date by stock imports + manual edits via
  // services/stockReconciler.ts — so manual corrections feed straight into
  // shortage planning.
  const rawNeedG = new Map<string, number>();
  // Primary packaging, bare (overage applied at the line).
  const compNeedUnits = new Map<string, number>();
  const warnings: string[] = [];
  const acceptedSet = new Set(acceptedDependencyIds);
  // Packing-scheme runs (finished units and bulk mass), resolved to whole
  // pieces by schemeDemand after the loop.
  const schemeRuns: SchemeRun[] = [];

  const addIngredients = (product: Product, totalMassG: number) => {
    for (const ing of product.ingredients) {
      rawNeedG.set(
        ing.rawMaterialId,
        (rawNeedG.get(ing.rawMaterialId) ?? 0) + totalMassG * (ing.percentage / 100),
      );
    }
  };

  for (const item of plan.items) {
    const product = products.get(item.productId);
    if (!product) {
      warnings.push(`Pozycja planu wskazuje na nieistniejący produkt (${item.productId}) — pominięto.`);
      continue;
    }
    addIngredients(product, product.capacityMl * product.densityGPerMl * item.qtyUnits);
    for (const pkg of product.packaging) {
      compNeedUnits.set(
        pkg.componentId,
        (compNeedUnits.get(pkg.componentId) ?? 0) + pkg.qtyPerUnit * item.qtyUnits,
      );
    }
    // Finished-unit production consumes ONLY 'product'-kind scheme packaging.
    schemeRuns.push({
      product: substituteProductScheme(product, substitutions),
      units: item.qtyUnits,
      bulkKg: 0,
    });
  }
  for (const bm of plan.bulkMass) {
    const product = products.get(bm.productId);
    if (!product) {
      warnings.push(`Masa luzem wskazuje na nieistniejący produkt (${bm.productId}) — pominięto.`);
      continue;
    }
    addIngredients(product, bm.massKg * 1000);
    // Bulk-mass production consumes ONLY 'mass'-kind packaging — a barrel
    // holds the bulk even if it never becomes finished units.
    schemeRuns.push({
      product: substituteProductScheme(product, substitutions),
      units: 0,
      bulkKg: bm.massKg,
    });
  }

  // Whole pieces per scheme component: containers rounded per product (no
  // mixing products in one barrel/carton), tape & other cascades summed over
  // the plan and rounded once — overage already inside.
  const scheme = schemeDemand(schemeRuns, components, compOverage);
  warnings.push(...scheme.warnings);

  for (const [fromId, toId] of Object.entries(substitutions)) {
    const from = baseComponents.get(fromId);
    const to = baseComponents.get(toId);
    if (from && to) {
      warnings.push(`Podmieniono opakowanie: „${from.name}" → „${to.name}".`);
    }
  }

  const rawLines: ShortageLine[] = [];
  for (const [id, neededG] of rawNeedG.entries()) {
    const rm = rawMaterials.get(id);
    if (!rm) {
      warnings.push(`Receptura wskazuje na nieistniejący surowiec (${id}) — pominięto.`);
      continue;
    }
    if (rm.factorySupplied) continue;

    // Recipes are mass-based. A material kept in a volume unit (l/ml) has no
    // density to convert with — leave it out of the math instead of treating
    // its stock as 0, and say so.
    // Apply this raw material's effective overage ("naddatek") to the bare
    // requirement accumulated above.
    const neededWithOverageG =
      neededG * effectiveOverageFactor(rm.overagePct, settings.defaultOveragePctRaw);

    // Recipes are mass-based. A material kept in a volume unit (l/ml) has no
    // density to compare its stock with: report the whole requirement (in kg)
    // as short so it still reaches the RFQ and the warehouse mail — the same
    // answer max-producible gives (0 units) — and say why.
    if (!isMassUnit(rm.unit)) {
      warnings.push(
        `Surowiec „${rm.name}" ma jednostkę „${rm.unit}" — bez gęstości nie da się porównać zapotrzebowania ze stanem; całe zapotrzebowanie pokazano jako brak (w kg), sprawdź ręcznie.`,
      );
      const neededKg = neededWithOverageG / 1000;
      rawLines.push({
        itemId: id,
        itemName: rm.name,
        itemKind: 'raw',
        unit: 'kg',
        required: neededKg,
        available: 0,
        shortage: neededKg,
        moq: rm.moq,
        suggestedOrder: ceilToMoq(neededKg, rm.moq),
        preferredSupplierId: rm.preferredSupplierId,
      });
      continue;
    }
    // Expiry-aware: expired batches are excluded unless the user opted to
    // count them for this run. Batch-less materials use their flat stockQty.
    const availableG = toGrams(availableStockQty(rm, asOf, includeSet), rm.unit);
    const shortageG = Math.max(0, neededWithOverageG - availableG);

    // Everything reported is in the material's own unit. MOQ is kept in kg
    // (the catalog import fills it from the package size in kg), so convert it.
    const moqInUnit = rm.moq ? gramsTo(rm.moq * 1000, rm.unit) : rm.moq;
    rawLines.push({
      itemId: id,
      itemName: rm.name,
      itemKind: 'raw',
      unit: rm.unit,
      required: gramsTo(neededWithOverageG, rm.unit),
      available: gramsTo(availableG, rm.unit),
      shortage: gramsTo(shortageG, rm.unit),
      moq: moqInUnit,
      suggestedOrder: ceilToMoq(gramsTo(shortageG, rm.unit), moqInUnit),
      preferredSupplierId: rm.preferredSupplierId,
    });
  }

  // Every component the plan touches: primary packaging + scheme demand.
  const allCompIds = new Set<string>([...compNeedUnits.keys(), ...scheme.needs.keys()]);

  // Names of the plan-involved parents that pull a cascade component in via
  // their 'dependencies' — context shown in the accept prompt.
  const consumedByNames = (depId: string): string[] => {
    const names: string[] = [];
    for (const parentId of allCompIds) {
      const parent = components.get(parentId);
      if (parent?.dependencies?.some((d) => d.componentId === depId)) {
        names.push(parent.name);
      }
    }
    return names;
  };

  const componentLines: ShortageLine[] = [];
  const dependencyShortages: DependencyShortageRef[] = [];
  for (const id of allCompIds) {
    const comp = components.get(id);
    if (!comp) {
      warnings.push(`Receptura wskazuje na nieistniejący komponent (${id}) — pominięto.`);
      continue;
    }
    const schemeNeed = scheme.needs.get(id);
    // Primary packaging: apply this component's effective overage
    // ("naddatek"), then round up — components are whole pieces (ceilPieces
    // guards against float drift on exact multiples). Scheme pieces come
    // already whole, overage included.
    const neededWithOverage =
      ceilPieces((compNeedUnits.get(id) ?? 0) * compOverage(comp)) + (schemeNeed?.pieces ?? 0);
    const isDirect = !!schemeNeed?.direct;
    const isCascade = !!schemeNeed?.cascade;
    const available = comp.stockQty ?? 0;
    const shortage = Math.max(0, neededWithOverage - available);
    // Shared-packaging component (direct tier or "zużywa" cascade) that is
    // short: surface it for the per-run prompt (accept / substitute); when
    // the user accepted the shortage, leave the line out of the report
    // entirely (a substitute will be used — nothing to order).
    if (shortage > 0 && (isDirect || isCascade)) {
      const accepted = acceptedSet.has(id);
      dependencyShortages.push({
        componentId: id,
        componentName: comp.name,
        origin: isDirect ? 'tier' : 'cascade',
        consumedBy: consumedByNames(id),
        available,
        required: neededWithOverage,
        shortage,
        accepted,
      });
      if (accepted) {
        warnings.push(
          `Zaakceptowano brak „${comp.name}" (opakowanie zbiorcze) — pominięto w raporcie.`,
        );
        continue;
      }
    }
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

  // Components the user swapped out for this run ("podmiana") vanish from the
  // math — the substitute took their place — so nothing above records them.
  // The report still has to carry that decision so the user can revise it, so
  // recover each original's real numbers from a baseline run (nothing accepted,
  // no swaps). The inner call gets an empty substitution map, so it never
  // recurses any deeper.
  if (Object.keys(substitutions).length > 0) {
    const baseline = await computeShortages(planId, db, includeExpiredBatchIds, [], {});
    const baseRefs = new Map(
      (baseline.dependencyShortages ?? []).map((r) => [r.componentId, r]),
    );
    for (const [fromId, toId] of Object.entries(substitutions)) {
      const from = baseComponents.get(fromId);
      if (!from) continue;
      const base = baseRefs.get(fromId);
      dependencyShortages.push({
        ...(base ?? {
          componentId: fromId,
          componentName: from.name,
          origin: scheme.needs.get(toId)?.direct ? 'tier' : 'cascade',
          consumedBy: [],
          available: from.stockQty ?? 0,
        }),
        accepted: false,
        substitutedWithId: toId,
        substitutedWithName: baseComponents.get(toId)?.name,
      });
    }
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
    dependencyShortages,
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
  const [plan, productList, rawList] = await Promise.all([
    db.getPlan(planId),
    db.listProducts(),
    db.listRawMaterials(),
  ]);
  if (!plan) throw new Error(`Plan ${planId} not found`);
  const products = new Map(productList.map((p) => [p.id, p]));
  const rawMaterials = new Map(rawList.map((r) => [r.id, r]));
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
