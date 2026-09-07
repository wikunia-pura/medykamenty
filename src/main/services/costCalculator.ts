import type Database from '../database';
import type { CostReport, CostBreakdownLine, CostItemLine } from '../../shared/types';
import { pricePerGram } from '../utils/units';
import { nowIso } from '../utils/id';
import { walkSchemePerProduct, piecesPerProduct, ceilPieces } from './packingConsumption';

// Packaging is always quoted and consumed per piece — shared packaging
// fractionally (1/24 of a carton per product), primary packaging in whole ones.
const PIECE = 'szt.';

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
    // Every catalog item behind this product's unit cost, for the drill-down.
    const items: CostItemLine[] = [];

    let ingredientsCost = 0;
    for (const ing of product.ingredients) {
      const rm = rawMaterials.get(ing.rawMaterialId);
      if (!rm) continue;
      const gPerUnit = massPerUnitG * (ing.percentage / 100);
      const line: CostItemLine = {
        kind: 'raw',
        itemId: rm.id,
        itemName: rm.name,
        qtyPerUnit: gPerUnit,
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
        continue;
      }
      line.cost = gPerUnit * pricePerG;
      ingredientsCost += line.cost;
    }

    let packagingCost = 0;
    for (const pkg of product.packaging) {
      const comp = components.get(pkg.componentId);
      if (!comp) continue;
      const line: CostItemLine = {
        kind: 'component',
        itemId: comp.id,
        itemName: comp.name,
        qtyPerUnit: pkg.qtyPerUnit,
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
      line.cost = pkg.qtyPerUnit * comp.lastPurchasePriceNet;
      packagingCost += line.cost;
    }

    // Shared/shipping packaging via the scheme. walkSchemeConsumption returns
    // every component touched per product unit (direct tiers + cascaded
    // dependencies). Cost share = price × (pieces consumed per product) =
    // price × unitsConsumed / capacity.
    let bulkPackagingCost = 0;
    for (const entry of walkSchemePerProduct(product, components)) {
      const comp = components.get(entry.componentId);
      if (!comp) continue;
      const pieces = piecesPerProduct(comp, entry.unitsConsumedPerProduct);
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
      bulkPackagingCost += line.cost;
      const key = `${product.id}:${comp.id}`;
      const acc = schemePieces.get(key) ?? { pieces: 0, price: comp.lastPurchasePriceNet };
      acc.pieces += pieces * item.qtyUnits;
      schemePieces.set(key, acc);
    }

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
