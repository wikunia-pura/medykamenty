import type Database from '../database';
import type { CostReport, CostBreakdownLine } from '../../shared/types';
import { pricePerGram } from '../utils/units';
import { nowIso } from '../utils/id';
import { walkSchemePerProduct, piecesPerProduct, ceilPieces } from './packingConsumption';

export async function computeCost(planId: string, db: Database): Promise<CostReport> {
  const plan = await db.getPlan(planId);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const products = new Map((await db.listProducts()).map((p) => [p.id, p]));
  const rawMaterials = new Map((await db.listRawMaterials()).map((r) => [r.id, r]));
  const components = new Map((await db.listComponents()).map((c) => [c.id, c]));

  const perProduct: CostBreakdownLine[] = [];
  let totalPlanCost = 0;
  // Shared packaging: unit cost carries the fractional share (1/24 of a
  // carton), but the plan buys whole pieces — and pieces are PER PRODUCT
  // (different products never share a carton/barrel). Fractional totals
  // accumulate here per (product, component); the last-piece remainder is
  // added to totalPlanCost once, after the item loop.
  const schemePieces = new Map<string, { pieces: number; price: number }>();

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

    // Shared/shipping packaging via the scheme. walkSchemeConsumption returns
    // every component touched per product unit (direct tiers + cascaded
    // dependencies). Cost share = price × (pieces consumed per product) =
    // price × unitsConsumed / capacity.
    for (const entry of walkSchemePerProduct(product, components)) {
      const comp = components.get(entry.componentId);
      if (!comp) continue;
      if (comp.lastPurchasePriceNet === undefined) {
        missing.push({ itemId: comp.id, itemName: comp.name, kind: 'component' });
        continue;
      }
      const pieces = piecesPerProduct(comp, entry.unitsConsumedPerProduct);
      if (!Number.isFinite(pieces) || pieces <= 0) continue;
      packagingCost += comp.lastPurchasePriceNet * pieces;
      const key = `${product.id}:${comp.id}`;
      const acc = schemePieces.get(key) ?? { pieces: 0, price: comp.lastPurchasePriceNet };
      acc.pieces += pieces * item.qtyUnits;
      schemePieces.set(key, acc);
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

  // Round each (product, component) up to whole pieces and charge the
  // remainder of the last, partially-filled piece per product.
  for (const { pieces, price } of schemePieces.values()) {
    if (pieces <= 0) continue;
    totalPlanCost += (ceilPieces(pieces) - pieces) * price;
  }

  return {
    planId,
    computedAt: nowIso(),
    perProduct,
    totalPlanCost,
  };
}
