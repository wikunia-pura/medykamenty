import type Database from '../database';
import type {
  CostReport,
  CostBreakdownLine,
  CostBulkMassLine,
  CostItemLine,
  PackagingComponent,
  Product,
  RawMaterial,
} from '../../shared/types';
import { pricePerGram } from '../utils/units';
import { nowIso } from '../utils/id';
import { effectiveOverageFactor } from '../../shared/overage';
import {
  walkSchemePerProduct,
  walkSchemePerBulkKg,
  piecesPerProduct,
  ceilPieces,
  schemeDemand,
  type SchemeRun,
  type SchemeWalkEntry,
} from './packingConsumption';

// Packaging is always quoted and consumed per piece — shared packaging
// fractionally (1/24 of a carton per product), primary packaging in whole ones.
const PIECE = 'szt.';

type MissingPrice = CostBreakdownLine['missingPriceItems'][number];

// Quantities are costed exactly as the shortage report orders them: every
// raw material / component carries its effective overage ("naddatek"), and
// the plan total charges whole pieces of packaging (see schemeDemand).
export async function computeCost(planId: string, db: Database): Promise<CostReport> {
  // Independent reads — each is a round trip, so run them together.
  const [plan, productList, rawList, componentList] = await Promise.all([
    db.getPlan(planId),
    db.listProducts(),
    db.listRawMaterials(),
    db.listComponents(),
  ]);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const settings = db.getSettings();
  const defaultCurrency = settings.defaultCurrency || 'PLN';
  const products = new Map(productList.map((p) => [p.id, p]));
  const rawMaterials = new Map(rawList.map((r) => [r.id, r]));
  const components = new Map(componentList.map((c) => [c.id, c]));
  const rawOverage = (rm: RawMaterial) =>
    effectiveOverageFactor(rm.overagePct, settings.defaultOveragePctRaw);
  const compOverage = (comp: PackagingComponent) =>
    effectiveOverageFactor(comp.overagePct, settings.defaultOveragePctComponent);

  const warnings: string[] = [];
  const warn = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };
  // Currencies of everything actually charged — no rate source, so a mix is
  // summed as-is and flagged.
  const currencies = new Set<string>();

  const perProduct: CostBreakdownLine[] = [];
  const bulkMass: CostBulkMassLine[] = [];
  let totalPlanCost = 0;
  // Unit costs carry fractional shares (1/24 of a carton, 1.05 bottles), but
  // the plan buys whole pieces. What the shares already charged is tracked
  // per component, and the difference to the whole pieces the shortage report
  // would order is added to totalPlanCost once, after the loops.
  const schemeCharged = new Map<string, number>();
  const schemeRuns: SchemeRun[] = [];
  const primaryBare = new Map<string, number>();

  // Ingredients for `massG` grams of the product (one unit, or 1 kg of bulk).
  const costIngredients = (
    product: Product,
    massG: number,
    missing: MissingPrice[],
    items: CostItemLine[],
  ): number => {
    let cost = 0;
    for (const ing of product.ingredients) {
      const rm = rawMaterials.get(ing.rawMaterialId);
      if (!rm) {
        warn(
          `Receptura „${product.name}" wskazuje na nieistniejący surowiec (${ing.rawMaterialId}) — pominięto w koszcie.`,
        );
        continue;
      }
      // Grams incl. overage, so qty × price = cost in the drill-down.
      const grams = massG * (ing.percentage / 100) * rawOverage(rm);
      const line: CostItemLine = {
        kind: 'raw',
        itemId: rm.id,
        itemName: rm.name,
        qtyPerUnit: grams,
        qtyUnit: 'g',
        unitPrice: rm.lastPurchasePriceNet,
        priceUnit: rm.unit,
        currency: rm.currency,
        cost: 0,
        factorySupplied: rm.factorySupplied,
      };
      items.push(line);
      // Factory-supplied materials are costed via the factory invoice, not
      // here — shown in the drill-down (tagged) for visibility, but never
      // charged against unit cost or flagged as missing a price.
      if (rm.factorySupplied) continue;
      if (rm.lastPurchasePriceNet === undefined) {
        missing.push({ itemId: rm.id, itemName: rm.name, kind: 'raw' });
        continue;
      }
      let pricePerG: number;
      try {
        pricePerG = pricePerGram(rm.lastPurchasePriceNet, rm.unit);
      } catch {
        // Volume-priced material — no density on the price, so it cannot be
        // costed. Flag it exactly like a missing price.
        line.unitPrice = undefined;
        missing.push({ itemId: rm.id, itemName: rm.name, kind: 'raw' });
        warn(
          `Surowiec „${rm.name}" ma cenę za ${rm.unit} — bez gęstości nie da się go wycenić; pominięto w koszcie.`,
        );
        continue;
      }
      line.cost = grams * pricePerG;
      cost += line.cost;
      currencies.add(rm.currency ?? defaultCurrency);
    }
    return cost;
  };

  // Packing-scheme shares for one scope unit (a finished unit or 1 kg of
  // bulk), charged `scopeQty` times into schemeCharged.
  const costScheme = (
    entries: SchemeWalkEntry[],
    scopeQty: number,
    missing: MissingPrice[],
    items: CostItemLine[],
  ): number => {
    let cost = 0;
    for (const entry of entries) {
      const comp = components.get(entry.componentId);
      if (!comp) continue;
      // No capacity / zero consumption → 0 pieces; schemeDemand warns.
      const pieces = piecesPerProduct(comp, entry.unitsConsumedPerProduct) * compOverage(comp);
      if (!Number.isFinite(pieces) || pieces <= 0) continue;
      const line: CostItemLine = {
        kind: 'bulkPackaging',
        itemId: comp.id,
        itemName: comp.name,
        qtyPerUnit: pieces,
        qtyUnit: PIECE,
        unitPrice: comp.lastPurchasePriceNet,
        priceUnit: PIECE,
        currency: comp.currency,
        cost: 0,
        viaDependency: entry.viaDependency,
      };
      items.push(line);
      if (comp.lastPurchasePriceNet === undefined) {
        missing.push({ itemId: comp.id, itemName: comp.name, kind: 'component' });
        continue;
      }
      line.cost = comp.lastPurchasePriceNet * pieces;
      cost += line.cost;
      currencies.add(comp.currency ?? defaultCurrency);
      schemeCharged.set(comp.id, (schemeCharged.get(comp.id) ?? 0) + line.cost * scopeQty);
    }
    return cost;
  };

  for (const item of plan.items) {
    const product = products.get(item.productId);
    if (!product) {
      warn(`Pozycja planu wskazuje na nieistniejący produkt (${item.productId}) — pominięto w koszcie.`);
      continue;
    }

    const missing: MissingPrice[] = [];
    // Every catalog item behind this product's unit cost, for the drill-down.
    const items: CostItemLine[] = [];

    const ingredientsCost = costIngredients(
      product,
      product.capacityMl * product.densityGPerMl,
      missing,
      items,
    );

    let packagingCost = 0;
    for (const pkg of product.packaging) {
      const comp = components.get(pkg.componentId);
      if (!comp) {
        warn(
          `Receptura „${product.name}" wskazuje na nieistniejący komponent (${pkg.componentId}) — pominięto w koszcie.`,
        );
        continue;
      }
      const qty = pkg.qtyPerUnit * compOverage(comp);
      const line: CostItemLine = {
        kind: 'component',
        itemId: comp.id,
        itemName: comp.name,
        qtyPerUnit: qty,
        qtyUnit: PIECE,
        unitPrice: comp.lastPurchasePriceNet,
        priceUnit: PIECE,
        currency: comp.currency,
        cost: 0,
      };
      items.push(line);
      if (comp.lastPurchasePriceNet === undefined) {
        missing.push({ itemId: comp.id, itemName: comp.name, kind: 'component' });
        continue;
      }
      line.cost = qty * comp.lastPurchasePriceNet;
      packagingCost += line.cost;
      currencies.add(comp.currency ?? defaultCurrency);
      primaryBare.set(comp.id, (primaryBare.get(comp.id) ?? 0) + pkg.qtyPerUnit * item.qtyUnits);
    }

    // Shared/shipping packaging via the scheme: every 'product'-kind
    // component touched per finished unit (direct tiers + cascaded
    // dependencies). Share = price × (unitsConsumed / capacity) × overage.
    const bulkPackagingCost = costScheme(
      walkSchemePerProduct(product, components),
      item.qtyUnits,
      missing,
      items,
    );
    schemeRuns.push({ product, units: item.qtyUnits, bulkKg: 0 });

    const laborCost = product.conversionLaborCost ?? 0;
    const unitCost = ingredientsCost + packagingCost + bulkPackagingCost + laborCost;
    totalPlanCost += unitCost * item.qtyUnits;

    perProduct.push({
      productId: product.id,
      productName: product.name,
      unitCost,
      ingredientsCost,
      packagingCost,
      bulkPackagingCost,
      laborCost,
      missingPriceItems: missing,
      items,
    });
  }

  // Bulk mass ("masa luzem"): ingredients per kg plus 'mass'-kind packaging
  // (barrels, bags) — the same scope the shortage report's bulk branch uses.
  // No finished-unit packaging and no conversion labor.
  for (const bm of plan.bulkMass) {
    const product = products.get(bm.productId);
    if (!product) {
      warn(`Masa luzem wskazuje na nieistniejący produkt (${bm.productId}) — pominięto w koszcie.`);
      continue;
    }
    const missing: MissingPrice[] = [];
    const items: CostItemLine[] = [];
    const ingredientsCostPerKg = costIngredients(product, 1000, missing, items);
    const bulkPackagingCostPerKg = costScheme(
      walkSchemePerBulkKg(product, components),
      bm.massKg,
      missing,
      items,
    );
    schemeRuns.push({ product, units: 0, bulkKg: bm.massKg });
    const costPerKg = ingredientsCostPerKg + bulkPackagingCostPerKg;
    const totalCost = costPerKg * bm.massKg;
    totalPlanCost += totalCost;
    bulkMass.push({
      productId: product.id,
      productName: product.name,
      massKg: bm.massKg,
      costPerKg,
      ingredientsCostPerKg,
      bulkPackagingCostPerKg,
      totalCost,
      missingPriceItems: missing,
      items,
    });
  }

  // Whole pieces: charge what the shortage report would order minus the
  // fractional shares already in the unit costs. Scheme packaging is rounded
  // per product for containers and once per plan for tape & other cascades
  // (schemeDemand); primary packaging once per plan.
  const scheme = schemeDemand(schemeRuns, components, compOverage);
  for (const w of scheme.warnings) warn(w);
  for (const [componentId, need] of scheme.needs) {
    const price = components.get(componentId)?.lastPurchasePriceNet;
    if (price === undefined) continue; // flagged as a missing price above
    totalPlanCost += need.pieces * price - (schemeCharged.get(componentId) ?? 0);
  }
  for (const [componentId, bare] of primaryBare) {
    const comp = components.get(componentId)!;
    const withOverage = bare * compOverage(comp);
    totalPlanCost += (ceilPieces(withOverage) - withOverage) * comp.lastPurchasePriceNet!;
  }

  if (currencies.size > 1) {
    warn(
      `Plan łączy ceny w różnych walutach (${[...currencies].sort().join(', ')}) — kwoty zsumowano bez przeliczania kursu, łączny koszt jest orientacyjny.`,
    );
  }

  return {
    planId,
    computedAt: nowIso(),
    perProduct,
    totalPlanCost,
    warnings,
    bulkMass,
  };
}
