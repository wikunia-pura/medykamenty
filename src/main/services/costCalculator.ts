import type Database from '../database';
import type { CostReport, CostBreakdownLine } from '../../shared/types';
import { pricePerGram } from '../utils/units';
import { nowIso } from '../utils/id';

export function computeCost(planId: string, db: Database): CostReport {
  const plan = db.getPlan(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const products = new Map(db.listProducts().map((p) => [p.id, p]));
  const rawMaterials = new Map(db.listRawMaterials().map((r) => [r.id, r]));
  const components = new Map(db.listComponents().map((c) => [c.id, c]));

  const perProduct: CostBreakdownLine[] = [];
  let totalPlanCost = 0;

  for (const item of plan.items) {
    const product = products.get(item.productId);
    if (!product) continue;

    const massPerUnitG = product.capacityMl * product.densityGPerMl;
    const missing: { itemId: string; itemName: string; kind: 'raw' | 'component' }[] = [];

    let ingredientsCost = 0;
    for (const ing of product.ingredients) {
      const rm = rawMaterials.get(ing.rawMaterialId);
      if (!rm) continue;
      if (rm.factorySupplied) {
        // factory-supplied raw materials: cost handled elsewhere (factory invoice).
        continue;
      }
      const gPerUnit = massPerUnitG * (ing.percentage / 100);
      if (rm.lastPurchasePriceNet === undefined) {
        missing.push({ itemId: rm.id, itemName: rm.name, kind: 'raw' });
        continue;
      }
      let pricePerG: number;
      try {
        pricePerG = pricePerGram(rm.lastPurchasePriceNet, rm.unit);
      } catch {
        missing.push({ itemId: rm.id, itemName: rm.name, kind: 'raw' });
        continue;
      }
      ingredientsCost += gPerUnit * pricePerG;
    }

    let packagingCost = 0;
    for (const pkg of product.packaging) {
      const comp = components.get(pkg.componentId);
      if (!comp) continue;
      if (comp.lastPurchasePriceNet === undefined) {
        missing.push({ itemId: comp.id, itemName: comp.name, kind: 'component' });
        continue;
      }
      packagingCost += pkg.qtyPerUnit * comp.lastPurchasePriceNet;
    }

    const laborCost = product.conversionLaborCost ?? 0;
    const unitCost = ingredientsCost + packagingCost + laborCost;
    totalPlanCost += unitCost * item.qtyUnits;

    perProduct.push({
      productId: product.id,
      productName: product.name,
      unitCost,
      ingredientsCost,
      packagingCost,
      laborCost,
      missingPriceItems: missing,
    });
  }

  return {
    planId,
    computedAt: nowIso(),
    perProduct,
    totalPlanCost,
  };
}
