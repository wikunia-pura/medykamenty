import type { Lang } from '../shared/types';

export interface T {
  appName: string;
  language: string;
  darkMode: string;
  // Navigation
  dashboard: string;
  products: string;
  rawMaterials: string;
  components: string;
  suppliers: string;
  stockImport: string;
  productionPlan: string;
  shortageReport: string;
  emailGenerator: string;
  costCalculator: string;
  maxProducible: string;
  settings: string;
  // Common
  add: string;
  edit: string;
  delete: string;
  save: string;
  cancel: string;
  close: string;
  search: string;
  loading: string;
  noData: string;
  yes: string;
  no: string;
  confirm: string;
  copy: string;
  copied: string;
  copyFailed: string;
  error: string;
  warning: string;
  // Common fields
  name: string;
  email: string;
  phone: string;
  notes: string;
  symbol: string;
  unit: string;
  quantity: string;
  price: string;
  currency: string;
  moq: string;
  leadTime: string;
  shelfLife: string;
  factorySupplied: string;
  preferredSupplier: string;
  alternativeSuppliers: string;
  preferredEmailLanguage: string;
  // Products
  capacityMl: string;
  density: string;
  laborCost: string;
  ingredients: string;
  packaging: string;
  percentage: string;
  qtyPerUnit: string;
  recipeSumWarning: string;
  recipeSumError: string;
  // Stock import
  selectXlsxFiles: string;
  importStockFiles: string;
  rawXlsxLabel: string;
  componentXlsxLabel: string;
  rowsImported: string;
  rowsMatched: string;
  rowsAmbiguous: string;
  rowsUnmatched: string;
  noStockYet: string;
  resolveAmbiguity: string;
  // Production plan
  planName: string;
  planItems: string;
  bulkMass: string;
  computeShortages: string;
  computeCost: string;
  generateEmails: string;
  // Shortage report
  required: string;
  available: string;
  shortage: string;
  suggestedOrder: string;
  bySupplier: string;
  noShortages: string;
  warnings: string;
  // Email generator
  emailLanguage: string;
  refineWithAI: string;
  aiUnavailable: string;
  // Cost
  unitCost: string;
  totalPlanCost: string;
  missingPrices: string;
  // Settings
  settingsLanguage: string;
  settingsDarkMode: string;
  settingsWasteFactor: string;
  settingsDefaultCurrency: string;
  settingsDefaultEmailLanguage: string;
  settingsLLM: string;
  settingsLLMDefault: string;
  settingsLLMStatus: string;
  settingsBackup: string;
  exportData: string;
  importData: string;
  importDataMerge: string;
  importDataReplace: string;
  about: string;
  appVersion: string;
  checkForUpdates: string;
  // Misc
  version: string;
  selectProduct: string;
  selectSupplier: string;
  unitsShort: string;
  // Max producible
  maxProducibleHero: string;
  maxProducibleEmptyRecipe: string;
  maxProducibleNoLimit: string;
  maxProducibleLimitedBy: string;
  maxProducibleWhyHeader: string;
  maxProducibleZeroStock: string;
  bottleneckTag: string;
  perUnitLabel: string;
  enoughFor: string;
  compute: string;
  // First-time guide
  firstTimeTitle: string;
  firstTimeStep1: string;
  firstTimeStep2: string;
  firstTimeStep3: string;
  firstTimeStep4: string;
  firstTimeStep5: string;
  firstTimeStep6: string;
  firstTimeStep7: string;
  firstTimeDemoHint: string;
  // Demo
  loadDemoTitle: string;
  loadDemoBody: string;
  loadDemoButton: string;
  loadDemoConfirm: string;
  loadDemoSuccess: string;
  wipeDataTitle: string;
  wipeDataBody: string;
  wipeDataButton: string;
  wipeDataConfirm: string;
  wipeDataSuccess: string;
  // Adopt unmatched
  adoptAsRaw: string;
  adoptAsComponent: string;
  adoptAllUnmatched: string;
  adoptAllConfirm: string;
  // Drop zone / actions
  dropZoneTitle: string;
  dropZoneSubtitle: string;
  dropZoneDragOver: string;
  actionsHeader: string;
  removeFile: string;
  // Footer
  zoom: string;
  zoomIn: string;
  zoomOut: string;
  zoomReset: string;
  updateAvailable: string;
  upToDate: string;
}

const pl: T = {
  appName: 'Cutis',
  language: 'Język',
  darkMode: 'Ciemny motyw',
  dashboard: 'Pulpit',
  products: 'Produkty',
  rawMaterials: 'Surowce',
  components: 'Komponenty',
  suppliers: 'Dostawcy',
  stockImport: 'Import stanów',
  productionPlan: 'Plan produkcji',
  shortageReport: 'Raport zapotrzebowania',
  emailGenerator: 'Generator maili',
  costCalculator: 'Kalkulator kosztów',
  maxProducible: 'Ile mogę wyprodukować',
  settings: 'Ustawienia',
  add: 'Dodaj',
  edit: 'Edytuj',
  delete: 'Usuń',
  save: 'Zapisz',
  cancel: 'Anuluj',
  close: 'Zamknij',
  search: 'Szukaj',
  loading: 'Ładowanie...',
  noData: 'Brak danych',
  yes: 'Tak',
  no: 'Nie',
  confirm: 'Potwierdź',
  copy: 'Kopiuj',
  copied: 'Skopiowano',
  copyFailed: 'Nie udało się skopiować',
  error: 'Błąd',
  warning: 'Ostrzeżenie',
  name: 'Nazwa',
  email: 'E-mail',
  phone: 'Telefon',
  notes: 'Uwagi',
  symbol: 'Symbol MP Firma',
  unit: 'Jednostka',
  quantity: 'Ilość',
  price: 'Cena (netto, ostatnia)',
  currency: 'Waluta',
  moq: 'MOQ',
  leadTime: 'Czas dostawy (dni)',
  shelfLife: 'Termin ważności (mies.)',
  factorySupplied: 'Dostarczane przez fabrykę',
  preferredSupplier: 'Preferowany dostawca',
  alternativeSuppliers: 'Alternatywni dostawcy',
  preferredEmailLanguage: 'Domyślny język maili',
  capacityMl: 'Pojemność (ml)',
  density: 'Gęstość (g/ml)',
  laborCost: 'Koszt konfekcji (zł/szt.)',
  ingredients: 'Surowce',
  packaging: 'Komponenty',
  percentage: 'Udział (%)',
  qtyPerUnit: 'Ilość / opakowanie',
  recipeSumWarning: 'Suma % poniżej 100 — woda dolewana do 100% jest pomijana w kalkulacji.',
  recipeSumError: 'Suma % przekracza 100 — popraw recepturę.',
  selectXlsxFiles: 'Wybierz pliki xlsx',
  importStockFiles: 'Importuj stany',
  rawXlsxLabel: 'Eksport surowców (xlsx)',
  componentXlsxLabel: 'Eksport komponentów (xlsx)',
  rowsImported: 'Zaimportowane wiersze',
  rowsMatched: 'Dopasowane',
  rowsAmbiguous: 'Wieloznaczne',
  rowsUnmatched: 'Niedopasowane',
  noStockYet: 'Brak zaimportowanych stanów. Zaimportuj pliki xlsx z MP Firma.',
  resolveAmbiguity: 'Rozstrzygnij',
  planName: 'Nazwa planu',
  planItems: 'Pozycje planu',
  bulkMass: 'Masa luzem (kg, do saszetek)',
  computeShortages: 'Oblicz zapotrzebowanie',
  computeCost: 'Oblicz koszt',
  generateEmails: 'Wygeneruj maile',
  required: 'Potrzeba',
  available: 'Stan',
  shortage: 'Brak',
  suggestedOrder: 'Do zamówienia',
  bySupplier: 'Wg dostawcy',
  noShortages: 'Brak braków — można uruchamiać produkcję.',
  warnings: 'Ostrzeżenia',
  emailLanguage: 'Język maila',
  refineWithAI: 'Popraw z AI',
  aiUnavailable: 'AI niedostępne — brak klucza w buildzie',
  unitCost: 'Koszt jednostkowy',
  totalPlanCost: 'Łączny koszt planu',
  missingPrices: 'Brak cen dla',
  settingsLanguage: 'Język aplikacji',
  settingsDarkMode: 'Ciemny motyw',
  settingsWasteFactor: 'Naddatek na straty (×)',
  settingsDefaultCurrency: 'Domyślna waluta',
  settingsDefaultEmailLanguage: 'Domyślny język maili RFQ',
  settingsLLM: 'AI / LLM',
  settingsLLMDefault: 'Domyślnie używaj AI w funkcjach AI-zdolnych',
  settingsLLMStatus: 'Status AI',
  settingsBackup: 'Kopia danych',
  exportData: 'Eksportuj dane',
  importData: 'Importuj dane',
  importDataMerge: 'Importuj (scal)',
  importDataReplace: 'Importuj (zastąp)',
  about: 'Informacje',
  appVersion: 'Wersja aplikacji',
  checkForUpdates: 'Sprawdź aktualizacje',
  version: 'wersja',
  selectProduct: 'Wybierz produkt',
  selectSupplier: 'Wybierz dostawcę',
  unitsShort: 'szt.',
  maxProducibleHero: 'Możesz wyprodukować',
  maxProducibleEmptyRecipe: 'Produkt nie ma receptury — uzupełnij surowce i komponenty.',
  maxProducibleNoLimit: 'Wszystkie pozycje są dostarczane przez fabrykę — brak ograniczeń materiałowych.',
  maxProducibleLimitedBy: 'Limituje',
  maxProducibleWhyHeader: 'Dlaczego nie więcej',
  maxProducibleZeroStock: 'Brak stanu — żadnej sztuki nie da się złożyć z aktualnymi danymi.',
  bottleneckTag: 'wąskie gardło',
  perUnitLabel: 'Na 1 szt.',
  enoughFor: 'Wystarczy na',
  compute: 'Oblicz',
  firstTimeTitle: 'Pierwsze uruchomienie — krok po kroku',
  firstTimeStep1: 'Dodaj dostawców w „Dostawcy" (nazwa, e-mail, język maila RFQ).',
  firstTimeStep2: 'Dodaj surowce w „Surowce" — przypisz preferowanego dostawcę, jednostkę i cenę.',
  firstTimeStep3: 'Dodaj komponenty w „Komponenty" (opakowania, etykiety, kartony) — również z dostawcą.',
  firstTimeStep4: 'Dodaj produkty w „Produkty" — wpisz recepturę: surowce w % i komponenty w sztukach.',
  firstTimeStep5: 'Zaimportuj stany magazynowe w „Import stanów" (eksporty xlsx z MP Firma).',
  firstTimeStep6: 'Utwórz plan w „Plan produkcji", wybierz produkty i kliknij „Oblicz zapotrzebowanie".',
  firstTimeStep7: 'Z raportu zapotrzebowania wygeneruj maile RFQ i wyślij do dostawców.',
  firstTimeDemoHint: 'Nie wiesz od czego zacząć? Wczytaj dane demo, żeby zobaczyć kompletny przykład — dostawców, surowce, produkt z recepturą, plan i stany.',
  loadDemoTitle: 'Dane demo',
  loadDemoBody:
    'Wczytuje fikcyjną firmę: 4 dostawców, 7 surowców (z jednym fabrycznym i jednym pustym), 3 komponenty, jeden produkt z recepturą, gotowy plan na 1000 sztuk i stany magazynowe. Po wczytaniu od razu można obliczyć zapotrzebowanie i wygenerować maile.',
  loadDemoButton: 'Wczytaj dane demo',
  loadDemoConfirm:
    'To zastąpi WSZYSTKIE obecne dane (dostawcy, surowce, komponenty, produkty, plany, stany). Ustawienia zostają. Kontynuować?',
  loadDemoSuccess: 'Wczytano dane demo. Przejdź do „Plan produkcji" i kliknij „Oblicz zapotrzebowanie".',
  wipeDataTitle: 'Wyczyść dane',
  wipeDataBody:
    'Usuwa WSZYSTKIE dane biznesowe (dostawcy, surowce, komponenty, produkty, plany, stany magazynowe). Ustawienia aplikacji zostają. Użyj, gdy chcesz wyjść z trybu demo i zacząć z czystym kontem.',
  wipeDataButton: 'Wyczyść wszystkie dane',
  wipeDataConfirm:
    'Tej operacji nie można cofnąć. Usunąć wszystkich dostawców, surowce, komponenty, produkty, plany i stany magazynowe? Ustawienia zostaną zachowane.',
  wipeDataSuccess: 'Dane wyczyszczone. Możesz teraz dodać własnych dostawców, surowce i produkty albo zaimportować backup.',
  adoptAsRaw: 'Dodaj jako surowiec',
  adoptAsComponent: 'Dodaj jako komponent',
  adoptAllUnmatched: '+ Dodaj wszystkie nierozpoznane ({n})',
  adoptAllConfirm: 'Utworzyć {n} nowych pozycji w katalogu na podstawie nierozpoznanych wierszy? Domyślne wartości: jednostka „kg" dla surowców, typ „other" dla komponentów; bez dostawcy. Możesz później dopiąć szczegóły w widokach Surowce/Komponenty.',
  dropZoneTitle: 'Przeciągnij i upuść pliki xlsx',
  dropZoneSubtitle: 'lub kliknij, aby wybrać. Akceptujemy eksporty MP Firma — surowce i komponenty.',
  dropZoneDragOver: 'Upuść pliki tutaj',
  actionsHeader: 'Akcje',
  removeFile: 'Usuń plik',
  zoom: 'Powiększenie',
  zoomIn: 'Powiększ',
  zoomOut: 'Pomniejsz',
  zoomReset: 'Resetuj powiększenie',
  updateAvailable: 'dostępna do pobrania',
  upToDate: 'Masz najnowszą wersję',
};

const en: T = {
  appName: 'Cutis',
  language: 'Language',
  darkMode: 'Dark mode',
  dashboard: 'Dashboard',
  products: 'Products',
  rawMaterials: 'Raw materials',
  components: 'Components',
  suppliers: 'Suppliers',
  stockImport: 'Stock import',
  productionPlan: 'Production plan',
  shortageReport: 'Shortage report',
  emailGenerator: 'Email generator',
  costCalculator: 'Cost calculator',
  maxProducible: 'How many can I produce',
  settings: 'Settings',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  search: 'Search',
  loading: 'Loading...',
  noData: 'No data',
  yes: 'Yes',
  no: 'No',
  confirm: 'Confirm',
  copy: 'Copy',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  error: 'Error',
  warning: 'Warning',
  name: 'Name',
  email: 'Email',
  phone: 'Phone',
  notes: 'Notes',
  symbol: 'MP Firma symbol',
  unit: 'Unit',
  quantity: 'Quantity',
  price: 'Price (net, last)',
  currency: 'Currency',
  moq: 'MOQ',
  leadTime: 'Lead time (days)',
  shelfLife: 'Shelf life (months)',
  factorySupplied: 'Supplied by factory',
  preferredSupplier: 'Preferred supplier',
  alternativeSuppliers: 'Alternative suppliers',
  preferredEmailLanguage: 'Default email language',
  capacityMl: 'Capacity (ml)',
  density: 'Density (g/ml)',
  laborCost: 'Confection cost (PLN/unit)',
  ingredients: 'Raw materials',
  packaging: 'Components',
  percentage: 'Share (%)',
  qtyPerUnit: 'Qty / package',
  recipeSumWarning: 'Sum below 100% — water filling to 100% is ignored in cost calculation.',
  recipeSumError: 'Sum exceeds 100% — fix the recipe.',
  selectXlsxFiles: 'Select xlsx files',
  importStockFiles: 'Import stock',
  rawXlsxLabel: 'Raw materials export (xlsx)',
  componentXlsxLabel: 'Components export (xlsx)',
  rowsImported: 'Rows imported',
  rowsMatched: 'Matched',
  rowsAmbiguous: 'Ambiguous',
  rowsUnmatched: 'Unmatched',
  noStockYet: 'No stock imported yet. Import xlsx files from MP Firma.',
  resolveAmbiguity: 'Resolve',
  planName: 'Plan name',
  planItems: 'Plan items',
  bulkMass: 'Bulk mass (kg, sachets)',
  computeShortages: 'Compute shortages',
  computeCost: 'Compute cost',
  generateEmails: 'Generate emails',
  required: 'Required',
  available: 'In stock',
  shortage: 'Shortage',
  suggestedOrder: 'To order',
  bySupplier: 'By supplier',
  noShortages: 'No shortages — production can start.',
  warnings: 'Warnings',
  emailLanguage: 'Email language',
  refineWithAI: 'Refine with AI',
  aiUnavailable: 'AI unavailable — no API key in build',
  unitCost: 'Unit cost',
  totalPlanCost: 'Total plan cost',
  missingPrices: 'Missing prices for',
  settingsLanguage: 'App language',
  settingsDarkMode: 'Dark mode',
  settingsWasteFactor: 'Waste factor (×)',
  settingsDefaultCurrency: 'Default currency',
  settingsDefaultEmailLanguage: 'Default RFQ email language',
  settingsLLM: 'AI / LLM',
  settingsLLMDefault: 'Use AI by default in AI-capable actions',
  settingsLLMStatus: 'AI status',
  settingsBackup: 'Data backup',
  exportData: 'Export data',
  importData: 'Import data',
  importDataMerge: 'Import (merge)',
  importDataReplace: 'Import (replace)',
  about: 'About',
  appVersion: 'App version',
  checkForUpdates: 'Check for updates',
  version: 'version',
  selectProduct: 'Select product',
  selectSupplier: 'Select supplier',
  unitsShort: 'pcs',
  maxProducibleHero: 'You can produce',
  maxProducibleEmptyRecipe: 'Product has no recipe — add raw materials and components.',
  maxProducibleNoLimit: 'All items are factory-supplied — no material constraints.',
  maxProducibleLimitedBy: 'Limited by',
  maxProducibleWhyHeader: 'Why not more',
  maxProducibleZeroStock: 'No stock — zero units can be produced with current data.',
  bottleneckTag: 'bottleneck',
  perUnitLabel: 'Per unit',
  enoughFor: 'Enough for',
  compute: 'Compute',
  firstTimeTitle: 'First launch — step by step',
  firstTimeStep1: 'Add suppliers in "Suppliers" (name, email, RFQ email language).',
  firstTimeStep2: 'Add raw materials in "Raw materials" — assign preferred supplier, unit and price.',
  firstTimeStep3: 'Add components in "Components" (packaging, labels, cartons) — also with a supplier.',
  firstTimeStep4: 'Add products in "Products" — define the recipe: raw materials in % and components in pieces.',
  firstTimeStep5: 'Import stock in "Stock import" (xlsx exports from MP Firma).',
  firstTimeStep6: 'Create a plan in "Production plan", pick products and click "Compute shortages".',
  firstTimeStep7: 'From the shortage report, generate RFQ emails and send them to suppliers.',
  firstTimeDemoHint: 'Not sure where to start? Load demo data to see a full example — suppliers, raw materials, a product with a recipe, a plan and stock.',
  loadDemoTitle: 'Demo data',
  loadDemoBody:
    'Loads a fictional company: 4 suppliers, 7 raw materials (one factory-supplied and one out of stock), 3 components, one product with a recipe, a ready plan for 1000 units, and stock snapshots. After loading you can compute shortages and generate emails right away.',
  loadDemoButton: 'Load demo data',
  loadDemoConfirm:
    'This will REPLACE all current data (suppliers, raw materials, components, products, plans, stock). Settings are preserved. Continue?',
  loadDemoSuccess: 'Demo data loaded. Go to "Production plan" and click "Compute shortages".',
  wipeDataTitle: 'Wipe data',
  wipeDataBody:
    'Removes ALL business data (suppliers, raw materials, components, products, plans, stock snapshots). App settings are kept. Use this to leave demo mode and start with a clean slate.',
  wipeDataButton: 'Wipe all data',
  wipeDataConfirm:
    'This cannot be undone. Delete every supplier, raw material, component, product, plan and stock snapshot? Settings will be preserved.',
  wipeDataSuccess: 'Data wiped. You can now add your own suppliers, materials and products, or import a backup.',
  adoptAsRaw: 'Add as raw material',
  adoptAsComponent: 'Add as component',
  adoptAllUnmatched: '+ Add all unmatched ({n})',
  adoptAllConfirm: 'Create {n} new catalog entries from unmatched rows? Defaults: unit "kg" for raw materials, type "other" for components; no supplier. You can fill in details later in Raw materials/Components.',
  dropZoneTitle: 'Drag & drop xlsx files',
  dropZoneSubtitle: 'or click to browse. Accepts MP Firma exports — raw materials and components.',
  dropZoneDragOver: 'Drop files here',
  actionsHeader: 'Actions',
  removeFile: 'Remove file',
  zoom: 'Zoom',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomReset: 'Reset zoom',
  updateAvailable: 'is available',
  upToDate: 'You have the latest version',
};

export const translations: Record<Lang, T> = { pl, en };
