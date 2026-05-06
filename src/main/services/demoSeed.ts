import type Database from '../database';
import { newId, nowIso } from '../utils/id';

export interface DemoSeedResult {
  suppliers: number;
  rawMaterials: number;
  components: number;
  products: number;
  plans: number;
  stockSnapshots: number;
}

// Wipes all business data (keeps user settings) and loads a fictional company:
// 4 suppliers, 7 raw materials (incl. one factory-supplied and one out-of-stock),
// 3 packaging components, 1 product with a realistic recipe, a draft plan for
// 1000 units, and stock snapshots that mirror the test_data MP Firma exports.
//
// Names of raw materials and components match the test_data xlsx files, so the
// matcher recognises them when the user later runs Stock Import on the real
// xlsx (it will refresh prices and create a fresh snapshot).
export function seedDemo(db: Database): DemoSeedResult {
  // Wipe everything except settings.
  db.importAll(
    {
      schemaVersion: 1,
      suppliers: [],
      rawMaterials: [],
      components: [],
      products: [],
      stockSnapshots: [],
      productionPlans: [],
      settings: db.getSettings(),
    },
    'replace',
  );

  // ---- Suppliers ----
  const surochem = db.createSupplier({
    name: 'Surochem Sp. z o.o.',
    email: 'zamowienia@surochem.example',
    phone: '+48 22 555 01 01',
    notes: 'Surfaktanty: Rocamina, Plantapon, APG.',
    preferredEmailLanguage: 'pl',
  });
  const cosmaterials = db.createSupplier({
    name: 'Cosmetic Materials Polska',
    email: 'sales@cosmaterials.example',
    phone: '+48 22 555 02 02',
    notes: 'Tłuszcze, masła, ekstrakty.',
    preferredEmailLanguage: 'pl',
  });
  const glikole = db.createSupplier({
    name: 'Glikole Polskie',
    email: 'biuro@glikole.example',
    notes: 'Glikol propylenowy farmaceutyczny — szybkie dostawy.',
    preferredEmailLanguage: 'pl',
  });
  const pakelo = db.createSupplier({
    name: 'Pakelo Opakowania',
    email: 'biuro@pakelo.example',
    phone: '+48 22 555 04 04',
    notes: 'Tuby, kartoniki, ulotki dla linii Cutis.',
    preferredEmailLanguage: 'pl',
  });

  // ---- Raw materials (names mirror MP Firma xlsx) ----
  const rocamina = db.createRawMaterial({
    name: 'Rocamina',
    unit: 'kg',
    supplierIds: [surochem.id],
    preferredSupplierId: surochem.id,
    factorySupplied: false,
    moq: 25,
    leadTimeDays: 14,
    lastPurchasePriceNet: 12.6,
    currency: 'PLN',
  });
  const plantapon = db.createRawMaterial({
    name: 'Plantapon',
    unit: 'kg',
    supplierIds: [surochem.id],
    preferredSupplierId: surochem.id,
    factorySupplied: false,
    moq: 20,
    leadTimeDays: 14,
    lastPurchasePriceNet: 18.46,
    currency: 'PLN',
  });
  const apiscalp = db.createRawMaterial({
    name: 'Apiscalp',
    unit: 'kg',
    supplierIds: [],
    factorySupplied: true,
    notes: 'Dostarczany przez fabrykę — pomijany w raporcie zapotrzebowania.',
  });
  const sheaButter = db.createRawMaterial({
    name: 'Shea butter care',
    unit: 'kg',
    supplierIds: [cosmaterials.id],
    preferredSupplierId: cosmaterials.id,
    factorySupplied: false,
    moq: 5,
    leadTimeDays: 21,
    lastPurchasePriceNet: 19.75,
    currency: 'PLN',
  });
  const tegoCare = db.createRawMaterial({
    name: 'Tego care',
    unit: 'kg',
    supplierIds: [cosmaterials.id],
    preferredSupplierId: cosmaterials.id,
    factorySupplied: false,
    moq: 5,
    leadTimeDays: 14,
    lastPurchasePriceNet: 113.17,
    currency: 'PLN',
  });
  const sulfidal = db.createRawMaterial({
    name: 'Sulfidal',
    unit: 'kg',
    supplierIds: [cosmaterials.id],
    preferredSupplierId: cosmaterials.id,
    factorySupplied: false,
    moq: 5,
    leadTimeDays: 21,
    lastPurchasePriceNet: 386.73,
    currency: 'PLN',
  });
  const glikol = db.createRawMaterial({
    name: 'Glikol propylenowy farmaceutyczny',
    unit: 'kg',
    supplierIds: [glikole.id],
    preferredSupplierId: glikole.id,
    factorySupplied: false,
    moq: 25,
    leadTimeDays: 7,
    lastPurchasePriceNet: 30,
    currency: 'PLN',
    notes: 'Stan magazynowy często przy zerze — pierwszy do uzupełnienia.',
  });

  // ---- Packaging components ----
  const tubaE = db.createComponent({
    name: 'Tuba Cutis E krem nowa',
    type: 'tube',
    supplierIds: [pakelo.id],
    preferredSupplierId: pakelo.id,
    moq: 1000,
    leadTimeDays: 28,
    lastPurchasePriceNet: 0.92,
    currency: 'PLN',
  });
  const kartonikE = db.createComponent({
    name: 'Kartonik produktowy Cutis E krem nowy',
    type: 'box',
    supplierIds: [pakelo.id],
    preferredSupplierId: pakelo.id,
    moq: 500,
    leadTimeDays: 21,
    lastPurchasePriceNet: 0.52,
    currency: 'PLN',
  });
  const ulotkaE = db.createComponent({
    name: 'Ulotka przyproduktowa Cutis E',
    type: 'leaflet',
    supplierIds: [pakelo.id],
    preferredSupplierId: pakelo.id,
    moq: 1000,
    leadTimeDays: 14,
    lastPurchasePriceNet: 0.5,
    currency: 'PLN',
  });

  // ---- Product with recipe ----
  // Sum of percentages = 90; the missing 10 % is "water to 100 %", ignored
  // (matches the realistic shampoo/cream recipe pattern from the brief).
  const product = db.createProduct({
    name: 'Cutis E Krem (100 ml) — Demo',
    sku: 'DEMO-CUTIS-E-KREM-100',
    capacityMl: 100,
    densityGPerMl: 1.0,
    conversionLaborCost: 1.5,
    ingredients: [
      { rawMaterialId: rocamina.id, percentage: 40 },
      { rawMaterialId: plantapon.id, percentage: 25 },
      { rawMaterialId: sheaButter.id, percentage: 8 },
      { rawMaterialId: tegoCare.id, percentage: 5 },
      { rawMaterialId: sulfidal.id, percentage: 4 },
      { rawMaterialId: apiscalp.id, percentage: 5 },
      { rawMaterialId: glikol.id, percentage: 3 },
    ],
    packaging: [
      { componentId: tubaE.id, qtyPerUnit: 1 },
      { componentId: kartonikE.id, qtyPerUnit: 1 },
      { componentId: ulotkaE.id, qtyPerUnit: 1 },
    ],
    notes:
      'Receptura demo. Suma 90 % — pozostałe 10 % to woda dolewana do 100 % (pomijane w kalkulacji).',
    archived: false,
  });

  // ---- Stock snapshots that mirror test_data xlsx (so shortage flow works
  // immediately, even before the user runs the real Stock Import) ----
  const importedAt = nowIso();
  db.addStockSnapshot({
    id: newId(),
    importedAt,
    sourceFile: 'demo-magazyn-surowce.xlsx',
    kind: 'raw',
    rows: [
      {
        rowKey: 'demo-raw-1',
        name: 'Rocamina',
        qty: 315.3,
        oNet: 12.6,
        currency: 'PLN',
        matchedRawMaterialId: rocamina.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
      {
        rowKey: 'demo-raw-2',
        name: 'Plantapon',
        qty: 243,
        oNet: 18.46,
        currency: 'PLN',
        matchedRawMaterialId: plantapon.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
      {
        rowKey: 'demo-raw-3',
        name: 'Apiscalp',
        qty: 32,
        oNet: 318,
        currency: 'PLN',
        matchedRawMaterialId: apiscalp.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
      {
        rowKey: 'demo-raw-4',
        name: 'Shea butter care',
        qty: 106.9,
        oNet: 19.75,
        currency: 'PLN',
        matchedRawMaterialId: sheaButter.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
      {
        rowKey: 'demo-raw-5',
        name: 'Tego care',
        qty: 71.8,
        oNet: 113.17,
        currency: 'PLN',
        matchedRawMaterialId: tegoCare.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
      {
        rowKey: 'demo-raw-6',
        name: 'Sulfidal',
        qty: 25.7,
        oNet: 386.73,
        currency: 'PLN',
        matchedRawMaterialId: sulfidal.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
      {
        rowKey: 'demo-raw-7',
        name: 'Glikol propylenowy farmaceutyczny',
        qty: 0,
        oNet: 30,
        currency: 'PLN',
        matchedRawMaterialId: glikol.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
    ],
  });

  db.addStockSnapshot({
    id: newId(),
    importedAt,
    sourceFile: 'demo-magazyn-komponenty.xlsx',
    kind: 'component',
    rows: [
      {
        rowKey: 'demo-comp-1',
        name: 'Tuba Cutis E krem nowa',
        qty: 6776,
        oNet: 0.92,
        currency: 'PLN',
        matchedComponentId: tubaE.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
      {
        rowKey: 'demo-comp-2',
        name: 'Kartonik produktowy Cutis E krem nowy',
        qty: 8960,
        oNet: 0.52,
        currency: 'PLN',
        matchedComponentId: kartonikE.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
      {
        rowKey: 'demo-comp-3',
        name: 'Ulotka przyproduktowa Cutis E',
        qty: 10806,
        oNet: 0.5,
        currency: 'PLN',
        matchedComponentId: ulotkaE.id,
        matchConfidence: 1,
        matchAmbiguous: false,
      },
    ],
  });

  // ---- Pre-built plan so the user can jump straight to "Compute shortages" ----
  db.createPlan({
    name: 'Plan demo — 1000 szt. Cutis E Krem',
    items: [{ productId: product.id, qtyUnits: 1000 }],
    bulkMass: [],
    status: 'draft',
  });

  return {
    suppliers: 4,
    rawMaterials: 7,
    components: 3,
    products: 1,
    plans: 1,
    stockSnapshots: 2,
  };
}
