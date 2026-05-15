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
  outerPackaging: string;
  outerPackagingPropagate: string;
  outerPackagingPropagateTitle: string;
  outerPackagingPropagateHint: string;
  outerPackagingPropagateConfirm: string;
  outerPackagingPropagateSuccess: string;
  outerPackagingPropagateNeedCapacity: string;
  outerPackagingPropagateInProgress: string;
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
  deleteAll: string;
  deleteAllConfirm: string;
  deleteAllSuccess: string;
  deleteAllPartial: string;
  deleteAllInProgress: string;
  deleteBlockedTitle: string;
  deleteBlockedByRawMaterials: string;
  deleteBlockedByComponents: string;
  deleteBlockedByProducts: string;
  blockedByTitle: string;
  blockedBySubtitle: string;
  loaderImporting: string;
  loaderExporting: string;
  loaderComputing: string;
  loaderGenerating: string;
  loaderProcessing: string;
  loaderWiping: string;
  loaderSeeding: string;
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
  duplicate: string;
  error: string;
  warning: string;
  reset: string;
  columns: string;
  columnsConfigure: string;
  preview: string;
  previewMode: string;
  editMode: string;
  backToList: string;
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
  supplier: string;
  preferredSupplier: string;
  alternativeSuppliers: string;
  preferredEmailLanguage: string;
  contactPerson: string;
  paymentTerms: string;
  packageSize: string;
  // Raw materials XLSX import (Plik z surowcami)
  rawMaterialsImportXlsx: string;
  rawMaterialsImportXlsxHint: string;
  rawMaterialsImportSummary: string;
  rawMaterialsImportRawCreated: string;
  rawMaterialsImportRawUpdated: string;
  rawMaterialsImportRawSkipped: string;
  rawMaterialsImportRawDeleted: string;
  rawMaterialsImportSuppliersCreated: string;
  rawMaterialsImportSuppliersUpdated: string;
  rawMaterialsImportWarnings: string;
  rawMaterialsImportFailed: string;
  rawMaterialsImportDialogTitle: string;
  rawMaterialsImportModeMerge: string;
  rawMaterialsImportModeMergeDesc: string;
  rawMaterialsImportModeOverwrite: string;
  rawMaterialsImportModeOverwriteDesc: string;
  rawMaterialsImportConfirm: string;
  // Products
  capacityMl: string;
  density: string;
  laborCost: string;
  ingredients: string;
  packaging: string;
  percentage: string;
  qtyPerUnit: string;
  packingScheme: string;
  packingSchemeHint: string;
  packingCapacity: string;
  packingCapacityUnit: string;
  packingCapacityMissing: string;
  packingConsumption: string;
  packingConsumptionOverride: string;
  packingPerProduct: string;
  packingScope: string;
  packingScopePerUnit: string;
  packingScopePerBulk: string;
  packingBulkUnitInvalid: string;
  productTabBasics: string;
  componentDependencies: string;
  componentDependenciesHint: string;
  componentDependenciesConsumed: string;
  componentDependenciesAmount: string;
  unitUnits: string;
  moqUnits: string;
  planItemBelowMoqWarning: string;
  sachetMassKg: string;
  sachetsCount: string;
  recipeSumWarning: string;
  recipeSumError: string;
  // Recipe XLSX import/export (Plik z recepturami)
  recipesImportXlsx: string;
  recipesExportXlsx: string;
  recipesImportDialogTitle: string;
  recipesImportModeMerge: string;
  recipesImportModeMergeDesc: string;
  recipesImportModeOverwrite: string;
  recipesImportModeOverwriteDesc: string;
  recipesImportConfirm: string;
  recipesImportSummaryTitle: string;
  recipesImportProductsCreated: string;
  recipesImportProductsUpdated: string;
  recipesImportProductsSkipped: string;
  recipesImportRawCreated: string;
  recipesImportComponentsCreated: string;
  recipesImportQtyReviewNote: string;
  recipesImportWarnings: string;
  recipesImportPerProductTitle: string;
  recipesImportActionCreated: string;
  recipesImportActionUpdated: string;
  recipesImportActionSkipped: string;
  recipesExportSuccess: string;
  recipesExportFailed: string;
  recipesImportFailed: string;
  // Recipe import — unresolved items modal (analyze → resolve → commit)
  recipeUnresolvedTitle: string;
  recipeUnresolvedSubtitle: string;
  recipeUnresolvedSectionRaws: string;
  recipeUnresolvedSectionComponents: string;
  recipeUnresolvedColName: string;
  recipeUnresolvedColUsedIn: string;
  recipeUnresolvedAnalyzing: string;
  recipeUnresolvedCommitting: string;
  recipeUnresolvedApplyAll: string;
  recipeUnresolvedCancelAbort: string;
  recipeUnresolvedExpand: string;
  recipeUnresolvedNoneTitle: string;
  recipeUnresolvedNoneSubtitle: string;
  recipeUnresolvedRequiresTarget: string;
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
  stockWarehouse: string;
  stockNetUnit: string;
  stockVatUnit: string;
  stockGrossUnit: string;
  stockNetTotal: string;
  stockVatTotal: string;
  stockGrossTotal: string;
  stockManufacturer: string;
  stockMpFirmaId: string;
  stockEditRow: string;
  stockDeleteRow: string;
  stockDeleteSnapshot: string;
  stockDeleteSnapshotConfirm: string;
  stockSnapshotImported: string;
  stockSourceFile: string;
  stockUnmatchedOnly: string;
  stockAllMatched: string;
  // Production plan
  planName: string;
  reportName: string;
  selectedPlan: string;
  planItems: string;
  bulkMass: string;
  computeShortages: string;
  computeCost: string;
  generateEmails: string;
  planStatusDraft: string;
  planStatusComputed: string;
  planStatusArchived: string;
  planStatusDraftTooltip: string;
  planStatusComputedTooltip: string;
  planStatusArchivedTooltip: string;
  duplicatePlan: string;
  planCreatedAt: string;
  planUpdatedAt: string;
  planLinkedReports: string;
  planLinkedShortageReports: string;
  planLinkedEmailBatches: string;
  planNoLinkedReports: string;
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
  openInMailClient: string;
  // Cost
  unitCost: string;
  totalPlanCost: string;
  missingPrices: string;
  costCalculatorHeroHint: string;
  costCalculatorSelectPlans: string;
  missingPricesTooltipHeader: string;
  missingPricesTooltipExplain: string;
  missingPricesAllPriced: string;
  // Settings
  settingsLanguage: string;
  settingsDarkMode: string;
  settingsLightMode: string;
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
  download: string;
  // Misc
  version: string;
  selectProduct: string;
  selectSupplier: string;
  unitsShort: string;
  // Max producible
  maxProducibleHero: string;
  maxProducibleHeroHint: string;
  maxProducibleEmptyRecipe: string;
  maxProducibleNoLimit: string;
  maxProducibleLimitedBy: string;
  maxProducibleWhyHeader: string;
  maxProducibleZeroStock: string;
  maxProducibleSelectProducts: string;
  maxProducibleSelectAll: string;
  maxProducibleClearSelection: string;
  maxProducibleSelectedCount: string;
  maxProducibleRefresh: string;
  maxProducibleShowDetails: string;
  maxProducibleHideDetails: string;
  bottleneckTag: string;
  perUnitLabel: string;
  enoughFor: string;
  compute: string;
  // Dashboard
  dashboardStartStep: string;
  dashboardStartCta: string;
  dashboardStartHint: string;
  dashboardYourData: string;
  dashboardMissingItems: string;
  dashboardNoMissing: string;
  dashboardNoReportYet: string;
  dashboardLastReport: string;
  dashboardSeeFullReport: string;
  dashboardShortageBy: string;
  dashboardOrder: string;
  dashboardWelcomeEyebrow: string;
  dashboardWelcomeMorning: string;
  dashboardWelcomeAfternoon: string;
  dashboardWelcomeEvening: string;
  dashboardWelcomeNight: string;
  dashboardWelcomeTagline: string;
  dashboardWelcomeMottoIntro: string;
  dashboardWelcomeMotto: string;
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
  // Unmatched row resolution modal (smart match)
  resolveRowTitle: string;
  resolveRowSubtitleRaw: string;
  resolveRowSubtitleComponent: string;
  resolveRowFromImport: string;
  resolveRowSuggestions: string;
  resolveRowNoSuggestions: string;
  resolveRowSuggestionConfidence: string;
  resolveRowActionUseOnce: string;
  resolveRowActionUseOnceHint: string;
  resolveRowActionSaveAlias: string;
  resolveRowActionSaveAliasHint: string;
  resolveRowActionRename: string;
  resolveRowActionRenameHint: string;
  resolveRowActionAddNew: string;
  resolveRowActionAddNewHint: string;
  resolveRowChooseSuggestion: string;
  resolveRowPickAction: string;
  resolveRowProgress: string;
  resolveRowSkip: string;
  resolveRowDone: string;
  resolveRowAliasAdded: string;
  resolveRowRenameConfirm: string;
  // Bulk unmatched modal
  bulkResolveTitle: string;
  bulkSetAll: string;
  bulkColMapTo: string;
  bulkColAction: string;
  bulkPickTarget: string;
  bulkSkipRow: string;
  bulkUnskip: string;
  bulkSkipped: string;
  bulkApplyAll: string;
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
  // Per-view export/import
  exportCsv: string;
  importCsv: string;
  exportJson: string;
  importJson: string;
  exportLabel: string;
  importLabel: string;
  exportEmpty: string;
  importInvalidFile: string;
  // Workflow / wizard
  nextStep: string;
  goToShortageReport: string;
  goToEmailGenerator: string;
  selectPlanFirst: string;
  noPlansYet: string;
  addPlanCta: string;
  addFirstPlanHint: string;
  noProductsYet: string;
  defineProductsFirstHint: string;
  goToProductsCta: string;
  // Shortage report history
  olderReportsTitle: string;
  olderReportsHint: string;
  computedAtLabel: string;
  deleteReportConfirm: string;
  // Email generator
  emailGeneratorHeroTitle: string;
  emailGeneratorHeroHint: string;
  selectShortageReportFirst: string;
  noShortageReportsYet: string;
  goToShortageReportToCompute: string;
  shortageReportNoGroups: string;
  olderEmailBatchesTitle: string;
  olderEmailBatchesHint: string;
  generatedAtLabel: string;
  emailsCount: string;
  sentCount: string;
  markSent: string;
  unmarkSent: string;
  sentAtLabel: string;
  sentBadge: string;
  deleteBatchConfirm: string;
  emailBatchTitle: string;
  // Navigation history
  navBack: string;
  navForward: string;
  navHistory: string;
  openPlan: string;
  linkedPlanDeleted: string;
  linkedReportDeleted: string;
  linkedPlanDeletedTag: string;
  linkedReportDeletedTag: string;
}

const pl: T = {
  appName: 'Cutis Production Planner',
  language: 'Język',
  darkMode: 'Ciemny motyw',
  dashboard: 'Pulpit',
  products: 'Produkty',
  rawMaterials: 'Surowce',
  components: 'Komponenty',
  outerPackaging: 'Opakowania zbiorcze',
  outerPackagingPropagate: 'Propaguj do {products} produktów ({tiers} tier.)',
  outerPackagingPropagateTitle:
    'Zapisuje komponent i nadpisuje pojemność na wszystkich tier\'ach produktów używających tego komponentu.',
  outerPackagingPropagateHint:
    'Nadpisuje obecne pojemności na produktach. Edycje per produkt zostaną zastąpione.',
  outerPackagingPropagateConfirm:
    'Zastąpić pojemność na {tiers} tier(ach) w {products} produktach wartością {capacity} {unit} (komponent „{name}")? Indywidualne edycje na produktach zostaną nadpisane.',
  outerPackagingPropagateSuccess:
    'Zaktualizowano {tiers} tier(ów) w {products} produktach.',
  outerPackagingPropagateNeedCapacity: 'Ustaw pojemność > 0 zanim propagujesz.',
  outerPackagingPropagateInProgress: 'Propagowanie do produktów…',
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
  deleteAll: 'Usuń wszystkie',
  deleteAllConfirm:
    'Tej operacji nie można cofnąć. Usunąć wszystkie pozycje ({n}) z tego widoku?',
  deleteAllSuccess: 'Usunięto wszystkie pozycje ({n}).',
  deleteAllPartial:
    'Usunięto {n} z {total}. {blocked} nie można usunąć — są powiązane z innymi pozycjami.',
  deleteAllInProgress: 'Usuwanie pozycji…',
  deleteBlockedTitle: 'Nie można usunąć — pozycja jest powiązana z:',
  deleteBlockedByRawMaterials: 'Surowce',
  deleteBlockedByComponents: 'Komponenty',
  deleteBlockedByProducts: 'Produkty',
  blockedByTitle: 'Nie można usunąć',
  blockedBySubtitle:
    'Pozycja jest używana w innych miejscach ({n}). Usuń lub odepnij powiązania, aby kontynuować.',
  loaderImporting: 'Importowanie…',
  loaderExporting: 'Eksportowanie…',
  loaderComputing: 'Obliczanie…',
  loaderGenerating: 'Generowanie…',
  loaderProcessing: 'Przetwarzanie…',
  loaderWiping: 'Czyszczenie danych…',
  loaderSeeding: 'Wczytywanie danych demo…',
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
  duplicate: 'Duplikuj',
  reset: 'Resetuj',
  columns: 'Kolumny',
  columnsConfigure: 'Skonfiguruj widoczne kolumny',
  preview: 'Podgląd',
  previewMode: 'Tryb podglądu',
  editMode: 'Tryb edycji',
  backToList: 'Wróć',
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
  moq: 'Min. zamówienie',
  leadTime: 'Czas dostawy (dni)',
  shelfLife: 'Termin ważności (mies.)',
  factorySupplied: 'Dostarczane przez fabrykę',
  supplier: 'Dostawca',
  preferredSupplier: 'Preferowany dostawca',
  alternativeSuppliers: 'Alternatywni dostawcy',
  preferredEmailLanguage: 'Domyślny język maili',
  contactPerson: 'Osoba kontaktowa',
  paymentTerms: 'Warunki płatności',
  packageSize: 'Wielkość opakowania [kg]',
  rawMaterialsImportXlsx: 'Importuj plik z surowcami (xlsx)',
  rawMaterialsImportXlsxHint:
    'Wczyta arkusz z listą surowców (kolumny: nazwa, dostawca, kontakt, mail, telefon, wielkość opakowania, warunki płatności, ONetto, uwagi). Aplikacja utworzy/zaktualizuje dostawców i surowce; ręcznie wpisane pola pozostaną nietknięte.',
  rawMaterialsImportSummary: 'Import zakończony',
  rawMaterialsImportRawCreated: 'Surowce utworzone',
  rawMaterialsImportRawUpdated: 'Surowce zaktualizowane',
  rawMaterialsImportRawSkipped: 'Surowce pominięte',
  rawMaterialsImportRawDeleted: 'Surowce usunięte',
  rawMaterialsImportSuppliersCreated: 'Dostawcy utworzeni',
  rawMaterialsImportSuppliersUpdated: 'Dostawcy zaktualizowani',
  rawMaterialsImportWarnings: 'Ostrzeżenia',
  rawMaterialsImportFailed: 'Nie udało się zaimportować pliku',
  rawMaterialsImportDialogTitle: 'Import surowców z pliku XLSX',
  rawMaterialsImportModeMerge: 'Scal (aktualizuj istniejące)',
  rawMaterialsImportModeMergeDesc:
    'Aktualizuje surowce, które już są w bazie (zachowuje ręcznie wprowadzone pola, odświeża cenę, walutę, MOQ i preferowanego dostawcę), dodaje nowe. Surowce spoza pliku pozostają nietknięte.',
  rawMaterialsImportModeOverwrite: 'Zastąp (plik = źródło prawdy)',
  rawMaterialsImportModeOverwriteDesc:
    'Plik staje się źródłem prawdy: usuwa z bazy surowce, których nie ma w pliku, oraz nadpisuje pola z pliku dla pozostałych (cena, waluta, MOQ, dostawca, notatki). Dostawcy są zachowywani w obu trybach.',
  rawMaterialsImportConfirm: 'Importuj',
  capacityMl: 'Pojemność (ml)',
  density: 'Gęstość (g/ml)',
  laborCost: 'Koszt konfekcji (zł/szt.)',
  ingredients: 'Surowce',
  packaging: 'Komponenty',
  percentage: 'Udział (%)',
  qtyPerUnit: 'Ilość / opakowanie',
  packingScheme: 'Opakowanie zbiorcze',
  packingSchemeHint: 'Pojemność na komponencie, zużycie per produkt na tier.',
  packingCapacity: 'Pojemność',
  packingCapacityUnit: 'Jednostka',
  packingCapacityMissing: 'Komponent „{name}" nie ma ustawionej pojemności — kalkulacje będą puste.',
  packingConsumption: 'Zużycie',
  packingConsumptionOverride: 'Nadpisz ręcznie',
  packingPerProduct: 'Per produkt',
  packingScope: 'Powiązanie',
  packingScopePerUnit: 'Do produktu',
  packingScopePerBulk: 'Do masy własnej',
  packingBulkUnitInvalid: 'Powiązanie z masą wymaga jednostki kg lub l.',
  productTabBasics: 'Podstawowe dane',
  componentDependencies: 'Zużywa',
  componentDependenciesHint:
    '1 sztuka tego komponentu pociąga za sobą zużycie poniższych komponentów. Wartości w jednostkach pojemności komponentu zużywanego.',
  componentDependenciesConsumed: 'Komponent',
  componentDependenciesAmount: 'Ilość',
  unitUnits: 'szt.',
  moqUnits: 'MOQ produktu (szt.)',
  planItemBelowMoqWarning: 'Ilość poniżej MOQ produktu ({moq} szt.) — fabryka może nie przyjąć zamówienia.',
  sachetMassKg: 'Masa na saszetki (kg)',
  sachetsCount: 'Liczba saszetek (z masy)',
  recipeSumWarning: 'Suma % poniżej 100 — woda dolewana do 100% jest pomijana w kalkulacji.',
  recipeSumError: 'Suma % przekracza 100 — popraw recepturę.',
  recipesImportXlsx: 'Importuj receptury (xlsx)',
  recipesExportXlsx: 'Eksportuj receptury (xlsx)',
  recipesImportDialogTitle: 'Import receptur z pliku XLSX',
  recipesImportModeMerge: 'Scal (aktualizuj istniejące)',
  recipesImportModeMergeDesc:
    'Aktualizuje receptury produktów, które już są w bazie (zastępuje surowce i komponenty), dodaje nowe produkty. Produkty spoza pliku pozostają nietknięte.',
  recipesImportModeOverwrite: 'Zastąp (plik = źródło prawdy)',
  recipesImportModeOverwriteDesc:
    'Plik staje się źródłem prawdy: usuwa z bazy wszystkie produkty, których nie ma w pliku, oraz nadpisuje istniejące. Brakujące surowce i komponenty są tworzone w katalogu w obu trybach.',
  recipesImportConfirm: 'Importuj',
  recipesImportSummaryTitle: 'Podsumowanie importu',
  recipesImportProductsCreated: 'Utworzone produkty',
  recipesImportProductsUpdated: 'Zaktualizowane produkty',
  recipesImportProductsSkipped: 'Pominięte produkty',
  recipesImportRawCreated: 'Nowe surowce w katalogu',
  recipesImportComponentsCreated: 'Nowe komponenty w katalogu',
  recipesImportQtyReviewNote:
    'Kartony zbiorcze, taśmy, beczki i worki trafiły do "Opakowania zbiorczego" z pojemnością 1 — uzupełnij faktyczne pojemności (np. 50 produktów / karton) w edytorze produktu.',
  recipesImportWarnings: 'Ostrzeżenia',
  recipesImportPerProductTitle: 'Szczegóły per produkt',
  recipesImportActionCreated: 'utworzony',
  recipesImportActionUpdated: 'zaktualizowany',
  recipesImportActionSkipped: 'pominięty',
  recipesExportSuccess: 'Wyeksportowano receptury do pliku',
  recipesExportFailed: 'Eksport nie powiódł się',
  recipesImportFailed: 'Import nie powiódł się',
  recipeUnresolvedTitle: 'Nierozpoznane pozycje z pliku ({n})',
  recipeUnresolvedSubtitle:
    'Plik odwołuje się do surowców lub komponentów, których nie ma w katalogu. Wybierz, co zrobić z każdą pozycją zanim zaimportujemy produkty.',
  recipeUnresolvedSectionRaws: 'Surowce',
  recipeUnresolvedSectionComponents: 'Komponenty',
  recipeUnresolvedColName: 'Z pliku',
  recipeUnresolvedColUsedIn: 'Użyte w produktach',
  recipeUnresolvedAnalyzing: 'Analizuję plik…',
  recipeUnresolvedCommitting: 'Importuję produkty…',
  recipeUnresolvedApplyAll: 'Zastosuj i zaimportuj',
  recipeUnresolvedCancelAbort: 'Anuluj import',
  recipeUnresolvedExpand: 'Rozwiń pojedynczo',
  recipeUnresolvedNoneTitle: 'Wszystko jest już w katalogu',
  recipeUnresolvedNoneSubtitle: 'Możesz od razu kontynuować import.',
  recipeUnresolvedRequiresTarget:
    'Aby zapisać alias lub zmienić nazwę, najpierw wybierz dopasowanie z katalogu.',
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
  stockWarehouse: 'Magazyn',
  stockNetUnit: 'Cena netto',
  stockVatUnit: 'VAT',
  stockGrossUnit: 'Cena brutto',
  stockNetTotal: 'Wartość netto',
  stockVatTotal: 'VAT (suma)',
  stockGrossTotal: 'Wartość brutto',
  stockManufacturer: 'Symbol producenta',
  stockMpFirmaId: 'ID',
  stockEditRow: 'Edytuj wiersz',
  stockDeleteRow: 'Usuń wiersz',
  stockDeleteSnapshot: 'Usuń import',
  stockDeleteSnapshotConfirm: 'Usunąć cały zaimportowany stan ({kind})? Tej operacji nie można cofnąć.',
  stockSnapshotImported: 'Zaimportowano',
  stockSourceFile: 'Plik źródłowy',
  stockUnmatchedOnly: 'Tylko niedopasowane',
  stockAllMatched: 'Wszystkie pozycje zostały dopasowane.',
  planName: 'Nazwa planu',
  reportName: 'Nazwa raportu',
  selectedPlan: 'Wybrany plan',
  planItems: 'Pozycje planu',
  bulkMass: 'Masa luzem (kg, do saszetek)',
  computeShortages: 'Oblicz zapotrzebowanie',
  computeCost: 'Oblicz koszt',
  generateEmails: 'Wygeneruj maile',
  planStatusDraft: 'Szkic',
  planStatusComputed: 'Policzony',
  planStatusArchived: 'Zarchiwizowany',
  planStatusDraftTooltip: 'Plan utworzony, ale jeszcze nie policzono zapotrzebowania surowców i komponentów.',
  planStatusComputedTooltip: 'Zapotrzebowanie zostało policzone — można wygenerować raport braków, koszt i maile RFQ.',
  planStatusArchivedTooltip: 'Plan zarchiwizowany — pozostawiony do historii.',
  duplicatePlan: 'Duplikuj plan',
  planCreatedAt: 'Utworzono',
  planUpdatedAt: 'Ostatnia edycja',
  planLinkedReports: 'Powiązane raporty',
  planLinkedShortageReports: 'Raporty braków',
  planLinkedEmailBatches: 'Wygenerowane maile',
  planNoLinkedReports: 'Brak powiązanych raportów',
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
  openInMailClient: 'Otwórz w mailu',
  unitCost: 'Koszt jednostkowy',
  totalPlanCost: 'Łączny koszt planu',
  missingPrices: 'Brak cen dla',
  costCalculatorHeroHint: 'Wybierz jeden lub kilka planów, aby policzyć koszt jednostkowy każdego produktu i sumę całego planu.',
  costCalculatorSelectPlans: 'Wybierz plany',
  missingPricesTooltipHeader: 'Pozycje bez ceny zakupu',
  missingPricesTooltipExplain:
    'Te surowce / komponenty są w recepturze, ale nie mają zapisanej ostatniej ceny zakupu netto. Koszt jednostkowy i łączny są zaniżone — uzupełnij ceny w widoku Surowce lub Komponenty (pole „Ostatnia cena zakupu") albo zaimportuj dostawę.',
  missingPricesAllPriced:
    'Wszystkie surowce i komponenty mają zapisaną cenę — koszt jest kompletny.',
  settingsLanguage: 'Język aplikacji',
  settingsDarkMode: 'Ciemny motyw',
  settingsLightMode: 'Jasny motyw',
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
  download: 'Pobierz',
  version: 'wersja',
  selectProduct: 'Wybierz produkt',
  selectSupplier: 'Wybierz dostawcę',
  unitsShort: 'szt.',
  maxProducibleHero: 'Możesz wyprodukować',
  maxProducibleHeroHint: 'Wybierz jeden lub kilka produktów, aby zobaczyć ile sztuk można złożyć z aktualnych stanów.',
  maxProducibleEmptyRecipe: 'Produkt nie ma receptury — uzupełnij surowce i komponenty.',
  maxProducibleNoLimit: 'Wszystkie pozycje są dostarczane przez fabrykę — brak ograniczeń materiałowych.',
  maxProducibleLimitedBy: 'Limituje',
  maxProducibleWhyHeader: 'Dlaczego nie więcej',
  maxProducibleZeroStock: 'Brak stanu — żadnej sztuki nie da się złożyć z aktualnymi danymi.',
  maxProducibleSelectProducts: 'Wybierz produkty',
  maxProducibleSelectAll: 'Zaznacz wszystkie',
  maxProducibleClearSelection: 'Wyczyść',
  maxProducibleSelectedCount: 'wybrano',
  maxProducibleRefresh: 'Odśwież',
  maxProducibleShowDetails: 'Pokaż szczegóły',
  maxProducibleHideDetails: 'Ukryj szczegóły',
  bottleneckTag: 'wąskie gardło',
  perUnitLabel: 'Na 1 szt.',
  enoughFor: 'Wystarczy na',
  compute: 'Oblicz',
  dashboardStartStep: 'Krok 1',
  dashboardStartCta: 'Importuj stany magazynowe',
  dashboardStartHint: 'Wczytaj eksporty xlsx z MP Firma — to punkt startowy całego procesu.',
  dashboardYourData: 'Twoje dane',
  dashboardMissingItems: 'Brakujące pozycje',
  dashboardNoMissing: 'Brak braków — wszystko jest na stanie.',
  dashboardNoReportYet: 'Brak raportu zapotrzebowania. Utwórz plan i policz braki.',
  dashboardLastReport: 'Ostatni raport',
  dashboardSeeFullReport: 'Pokaż pełny raport',
  dashboardShortageBy: 'Wg dostawcy',
  dashboardOrder: 'Do zamówienia',
  dashboardWelcomeEyebrow: 'Cutis Production Planner',
  dashboardWelcomeMorning: 'Dzień dobry',
  dashboardWelcomeAfternoon: 'Miłego dnia',
  dashboardWelcomeEvening: 'Dobry wieczór',
  dashboardWelcomeNight: 'Pracujesz po nocy?',
  dashboardWelcomeTagline: 'Zaplanuj produkcję, sprawdź braki, wyślij maile RFQ — wszystko w jednym miejscu.',
  dashboardWelcomeMottoIntro: 'Pracuj z uśmiechem i powtarzaj nasze motto:',
  dashboardWelcomeMotto: 'Od jednego strzała jeszcze nikt się nie uzależnił',
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
  adoptAllUnmatched: 'Dodaj wszystkie nierozpoznane ({n})',
  adoptAllConfirm: 'Utworzyć {n} nowych pozycji w katalogu na podstawie nierozpoznanych wierszy? Domyślne wartości: jednostka „kg" dla surowców, typ „other" dla komponentów; bez dostawcy. Możesz później dopiąć szczegóły w widokach Surowce/Komponenty.',
  resolveRowTitle: 'Nierozpoznana pozycja',
  resolveRowSubtitleRaw: 'Surowiec z importu — wybierz, jak go dopasować do katalogu.',
  resolveRowSubtitleComponent: 'Komponent z importu — wybierz, jak go dopasować do katalogu.',
  resolveRowFromImport: 'Z importu',
  resolveRowSuggestions: 'Podobne w bazie',
  resolveRowNoSuggestions: 'Nie znalazłem żadnych zbliżonych pozycji w bazie.',
  resolveRowSuggestionConfidence: 'podobieństwo',
  resolveRowActionUseOnce: 'Użyj tylko w tym imporcie',
  resolveRowActionUseOnceHint: 'Powiąż ten wiersz z wybraną pozycją katalogu, ale bez zapisu na stałe.',
  resolveRowActionSaveAlias: 'Zapisz alias na stałe',
  resolveRowActionSaveAliasHint: 'Zapamiętaj „{import}" jako alias „{catalog}". Kolejne importy z tą nazwą będą dopasowane automatycznie.',
  resolveRowActionRename: 'Zmień nazwę w bazie',
  resolveRowActionRenameHint: 'Przepisz nazwę katalogową „{catalog}" na „{import}" (z importu). Dotychczasowa nazwa zostanie zapisana jako alias, więc stare powiązania działają dalej.',
  resolveRowActionAddNew: 'Dodaj jako nową pozycję',
  resolveRowActionAddNewHint: 'Utwórz nowy wpis w katalogu z nazwą z importu.',
  resolveRowChooseSuggestion: 'Wybierz pozycję z bazy, do której pasuje ten wiersz.',
  resolveRowPickAction: 'Wybierz akcję.',
  resolveRowProgress: 'Pozycja {n} z {total}',
  resolveRowSkip: 'Pomiń',
  resolveRowDone: 'Gotowe',
  resolveRowAliasAdded: 'Zapisano alias.',
  resolveRowRenameConfirm: 'Zmienić nazwę katalogową „{catalog}" na „{import}"? Stara nazwa zostanie zachowana jako alias.',
  bulkResolveTitle: 'Nierozpoznane pozycje ({n})',
  bulkSetAll: 'Ustaw wszystkim:',
  bulkColMapTo: 'Dopasuj do (z bazy)',
  bulkColAction: 'Akcja',
  bulkPickTarget: '— wybierz —',
  bulkSkipRow: 'Pomiń ten wiersz (zostaje nierozpoznany)',
  bulkUnskip: 'Przywróć',
  bulkSkipped: 'Pominięte',
  bulkApplyAll: 'Zastosuj wszystkie ({n})',
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
  exportCsv: 'Eksport CSV',
  importCsv: 'Import CSV',
  exportJson: 'Eksport JSON',
  importJson: 'Import JSON',
  exportLabel: 'Eksport',
  importLabel: 'Import',
  exportEmpty: 'Brak danych do eksportu',
  importInvalidFile: 'Nie udało się wczytać pliku',
  nextStep: 'Następny krok',
  goToShortageReport: 'Przejdź do raportu zapotrzebowania',
  goToEmailGenerator: 'Przejdź do generatora maili',
  selectPlanFirst: 'Wybierz plan, aby obliczyć zapotrzebowanie',
  noPlansYet: 'Brak planów produkcji',
  addPlanCta: 'Dodaj plan produkcji',
  addFirstPlanHint: 'Utwórz pierwszy plan produkcji, aby zaplanować surowce i komponenty.',
  noProductsYet: 'Brak produktów',
  defineProductsFirstHint:
    'Najpierw zdefiniuj produkty (z recepturami), aby móc utworzyć plan produkcji.',
  goToProductsCta: 'Przejdź do produktów',
  olderReportsTitle: 'Wcześniejsze raporty',
  olderReportsHint: 'Historia obliczonych zapotrzebowań',
  computedAtLabel: 'Obliczono',
  deleteReportConfirm: 'Usunąć raport',
  emailGeneratorHeroTitle: 'Wygeneruj maile RFQ',
  emailGeneratorHeroHint:
    'Wybierz raport zapotrzebowania — to on wskazuje dostawców, do których wyślesz zapytania.',
  selectShortageReportFirst: 'Wybierz raport zapotrzebowania',
  noShortageReportsYet: 'Brak raportów zapotrzebowania',
  goToShortageReportToCompute: 'Przejdź do raportu zapotrzebowania',
  shortageReportNoGroups: 'Brak braków — nie ma do kogo wysyłać maili.',
  olderEmailBatchesTitle: 'Wysłane partie maili',
  olderEmailBatchesHint: 'Historia wygenerowanych zapytań RFQ',
  generatedAtLabel: 'Wygenerowano',
  emailsCount: 'maili',
  sentCount: 'wysłane',
  markSent: 'Oznacz jako wysłany',
  unmarkSent: 'Cofnij oznaczenie',
  sentAtLabel: 'Wysłano',
  sentBadge: 'wysłany',
  deleteBatchConfirm: 'Usunąć partię maili',
  emailBatchTitle: 'Maile RFQ',
  navBack: 'Wstecz',
  navForward: 'Naprzód',
  navHistory: 'Nawigacja',
  openPlan: 'Otwórz plan',
  linkedPlanDeleted: 'Powiązany plan został usunięty i nie jest już dostępny.',
  linkedReportDeleted: 'Powiązany raport zapotrzebowania został usunięty i nie jest już dostępny.',
  linkedPlanDeletedTag: 'plan usunięty',
  linkedReportDeletedTag: 'raport usunięty',
};

const en: T = {
  appName: 'Cutis Production Planner',
  language: 'Language',
  darkMode: 'Dark mode',
  dashboard: 'Dashboard',
  products: 'Products',
  rawMaterials: 'Raw materials',
  components: 'Components',
  outerPackaging: 'Shipping packaging',
  outerPackagingPropagate: 'Propagate to {products} products ({tiers} tiers)',
  outerPackagingPropagateTitle:
    'Saves the component and overwrites the capacity on every product tier that uses this component.',
  outerPackagingPropagateHint:
    'Overwrites current capacity on those products. Per-product overrides will be replaced.',
  outerPackagingPropagateConfirm:
    'Replace capacity on {tiers} tier(s) across {products} products with {capacity} {unit} (component "{name}")? Per-product overrides will be lost.',
  outerPackagingPropagateSuccess:
    'Updated {tiers} tier(s) in {products} products.',
  outerPackagingPropagateNeedCapacity: 'Set capacity > 0 before propagating.',
  outerPackagingPropagateInProgress: 'Propagating to products…',
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
  deleteAll: 'Delete all',
  deleteAllConfirm:
    'This cannot be undone. Delete all items ({n}) from this view?',
  deleteAllSuccess: 'Deleted all items ({n}).',
  deleteAllPartial:
    'Deleted {n} of {total}. {blocked} could not be deleted — they are referenced by other entries.',
  deleteAllInProgress: 'Deleting items…',
  deleteBlockedTitle: 'Cannot delete — this item is referenced by:',
  deleteBlockedByRawMaterials: 'Raw materials',
  deleteBlockedByComponents: 'Components',
  deleteBlockedByProducts: 'Products',
  blockedByTitle: 'Cannot delete',
  blockedBySubtitle:
    'This item is referenced elsewhere ({n}). Remove or detach the references first to continue.',
  loaderImporting: 'Importing…',
  loaderExporting: 'Exporting…',
  loaderComputing: 'Computing…',
  loaderGenerating: 'Generating…',
  loaderProcessing: 'Processing…',
  loaderWiping: 'Wiping data…',
  loaderSeeding: 'Loading demo data…',
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
  duplicate: 'Duplicate',
  reset: 'Reset',
  columns: 'Columns',
  columnsConfigure: 'Configure visible columns',
  preview: 'Preview',
  previewMode: 'Preview mode',
  editMode: 'Edit mode',
  backToList: 'Back',
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
  moq: 'Min. order',
  leadTime: 'Lead time (days)',
  shelfLife: 'Shelf life (months)',
  factorySupplied: 'Supplied by factory',
  supplier: 'Supplier',
  preferredSupplier: 'Preferred supplier',
  alternativeSuppliers: 'Alternative suppliers',
  preferredEmailLanguage: 'Default email language',
  contactPerson: 'Contact person',
  paymentTerms: 'Payment terms',
  packageSize: 'Package size [kg]',
  rawMaterialsImportXlsx: 'Import raw materials file (xlsx)',
  rawMaterialsImportXlsxHint:
    'Loads a worksheet listing raw materials (columns: name, supplier, contact, email, phone, package size, payment terms, ONetto purchase price, notes). The app creates/updates suppliers and raw materials; manually edited fields are preserved.',
  rawMaterialsImportSummary: 'Import complete',
  rawMaterialsImportRawCreated: 'Raw materials created',
  rawMaterialsImportRawUpdated: 'Raw materials updated',
  rawMaterialsImportRawSkipped: 'Raw materials skipped',
  rawMaterialsImportRawDeleted: 'Raw materials deleted',
  rawMaterialsImportSuppliersCreated: 'Suppliers created',
  rawMaterialsImportSuppliersUpdated: 'Suppliers updated',
  rawMaterialsImportWarnings: 'Warnings',
  rawMaterialsImportFailed: 'Failed to import file',
  rawMaterialsImportDialogTitle: 'Import raw materials from XLSX',
  rawMaterialsImportModeMerge: 'Merge (update existing)',
  rawMaterialsImportModeMergeDesc:
    'Updates raw materials already in the database (keeps manually entered fields, refreshes price, currency, MOQ and preferred supplier), and adds new ones. Materials not in the file are left untouched.',
  rawMaterialsImportModeOverwrite: 'Replace (file = source of truth)',
  rawMaterialsImportModeOverwriteDesc:
    'The file becomes the source of truth: deletes raw materials missing from the file and overwrites file-driven fields (price, currency, MOQ, supplier, notes) for the rest. Suppliers are preserved in both modes.',
  rawMaterialsImportConfirm: 'Import',
  capacityMl: 'Capacity (ml)',
  density: 'Density (g/ml)',
  laborCost: 'Confection cost (PLN/unit)',
  ingredients: 'Raw materials',
  packaging: 'Components',
  percentage: 'Share (%)',
  qtyPerUnit: 'Qty / package',
  packingScheme: 'Shipping packaging',
  packingSchemeHint: 'Capacity lives on the component, per-product consumption on the tier.',
  packingCapacity: 'Capacity',
  packingCapacityUnit: 'Unit',
  packingCapacityMissing: 'Component "{name}" has no capacity set — calculations will be blank.',
  packingConsumption: 'Consumption',
  packingConsumptionOverride: 'Manual override',
  packingPerProduct: 'Per product',
  packingScope: 'Scope',
  packingScopePerUnit: 'Per product',
  packingScopePerBulk: 'Per bulk mass',
  packingBulkUnitInvalid: 'Bulk-mass scope requires kg or l capacity unit.',
  productTabBasics: 'Basics',
  componentDependencies: 'Consumes',
  componentDependenciesHint:
    'One unit of this component pulls the components below. Values are in the consumed component\'s capacity-unit.',
  componentDependenciesConsumed: 'Component',
  componentDependenciesAmount: 'Amount',
  unitUnits: 'units',
  moqUnits: 'Product MOQ (units)',
  planItemBelowMoqWarning: 'Quantity below product MOQ ({moq} units) — the factory may reject the order.',
  sachetMassKg: 'Sachet mass (kg)',
  sachetsCount: 'Sachets count (from mass)',
  recipeSumWarning: 'Sum below 100% — water filling to 100% is ignored in cost calculation.',
  recipeSumError: 'Sum exceeds 100% — fix the recipe.',
  recipesImportXlsx: 'Import recipes (xlsx)',
  recipesExportXlsx: 'Export recipes (xlsx)',
  recipesImportDialogTitle: 'Import recipes from XLSX',
  recipesImportModeMerge: 'Merge (update existing)',
  recipesImportModeMergeDesc:
    'Updates recipes for products that already exist in the database (replaces raw materials and components), adds new products. Products not present in the file are left untouched.',
  recipesImportModeOverwrite: 'Replace (file = source of truth)',
  recipesImportModeOverwriteDesc:
    'File becomes the source of truth: removes any products from the database that are not in the file, and overwrites existing ones. Missing raw materials and components are auto-created in either mode.',
  recipesImportConfirm: 'Import',
  recipesImportSummaryTitle: 'Import summary',
  recipesImportProductsCreated: 'Products created',
  recipesImportProductsUpdated: 'Products updated',
  recipesImportProductsSkipped: 'Products skipped',
  recipesImportRawCreated: 'New raw materials in catalog',
  recipesImportComponentsCreated: 'New components in catalog',
  recipesImportQtyReviewNote:
    'Outer cartons, tape, barrels and bags landed in "Shipping packaging" with capacity = 1 — please set the real capacity (e.g. 50 products / carton) in the product editor.',
  recipesImportWarnings: 'Warnings',
  recipesImportPerProductTitle: 'Per-product details',
  recipesImportActionCreated: 'created',
  recipesImportActionUpdated: 'updated',
  recipesImportActionSkipped: 'skipped',
  recipesExportSuccess: 'Recipes exported to file',
  recipesExportFailed: 'Export failed',
  recipesImportFailed: 'Import failed',
  recipeUnresolvedTitle: 'Unrecognized items from the file ({n})',
  recipeUnresolvedSubtitle:
    'The file references raw materials or components that aren’t in the catalog. Decide what to do with each one before we import the products.',
  recipeUnresolvedSectionRaws: 'Raw materials',
  recipeUnresolvedSectionComponents: 'Components',
  recipeUnresolvedColName: 'From file',
  recipeUnresolvedColUsedIn: 'Used in products',
  recipeUnresolvedAnalyzing: 'Analyzing file…',
  recipeUnresolvedCommitting: 'Importing products…',
  recipeUnresolvedApplyAll: 'Apply and import',
  recipeUnresolvedCancelAbort: 'Cancel import',
  recipeUnresolvedExpand: 'Expand one-by-one',
  recipeUnresolvedNoneTitle: 'Everything already exists in the catalog',
  recipeUnresolvedNoneSubtitle: 'You can continue with the import straight away.',
  recipeUnresolvedRequiresTarget:
    'To save an alias or rename, pick a catalog match first.',
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
  stockWarehouse: 'Warehouse',
  stockNetUnit: 'Net price',
  stockVatUnit: 'VAT',
  stockGrossUnit: 'Gross price',
  stockNetTotal: 'Net value',
  stockVatTotal: 'VAT (total)',
  stockGrossTotal: 'Gross value',
  stockManufacturer: 'Manufacturer symbol',
  stockMpFirmaId: 'ID',
  stockEditRow: 'Edit row',
  stockDeleteRow: 'Delete row',
  stockDeleteSnapshot: 'Delete import',
  stockDeleteSnapshotConfirm: 'Delete the entire imported stock ({kind})? This cannot be undone.',
  stockSnapshotImported: 'Imported',
  stockSourceFile: 'Source file',
  stockUnmatchedOnly: 'Unmatched only',
  stockAllMatched: 'All entries matched.',
  planName: 'Plan name',
  reportName: 'Report name',
  selectedPlan: 'Selected plan',
  planItems: 'Plan items',
  bulkMass: 'Bulk mass (kg, sachets)',
  computeShortages: 'Compute shortages',
  computeCost: 'Compute cost',
  generateEmails: 'Generate emails',
  planStatusDraft: 'Draft',
  planStatusComputed: 'Computed',
  planStatusArchived: 'Archived',
  planStatusDraftTooltip: 'Plan created, but raw material and component shortages have not been computed yet.',
  planStatusComputedTooltip: 'Shortages have been computed — you can view the shortage report, cost and generate RFQ emails.',
  planStatusArchivedTooltip: 'Plan archived — kept for history.',
  duplicatePlan: 'Duplicate plan',
  planCreatedAt: 'Created',
  planUpdatedAt: 'Last edit',
  planLinkedReports: 'Linked reports',
  planLinkedShortageReports: 'Shortage reports',
  planLinkedEmailBatches: 'Email batches',
  planNoLinkedReports: 'No linked reports',
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
  openInMailClient: 'Open in mail',
  unitCost: 'Unit cost',
  totalPlanCost: 'Total plan cost',
  missingPrices: 'Missing prices for',
  costCalculatorHeroHint: 'Pick one or more plans to compute unit cost for each product and the total plan cost.',
  costCalculatorSelectPlans: 'Select plans',
  missingPricesTooltipHeader: 'Items without a purchase price',
  missingPricesTooltipExplain:
    'These raw materials / components are in the recipe but have no recorded last net purchase price. Unit and total cost are understated — fill in the price in Raw materials or Components (field "Last purchase price"), or import a delivery.',
  missingPricesAllPriced:
    'All raw materials and components have a recorded price — cost is complete.',
  settingsLanguage: 'App language',
  settingsDarkMode: 'Dark mode',
  settingsLightMode: 'Light mode',
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
  download: 'Download',
  version: 'version',
  selectProduct: 'Select product',
  selectSupplier: 'Select supplier',
  unitsShort: 'pcs',
  maxProducibleHero: 'You can produce',
  maxProducibleHeroHint: 'Pick one or more products to see how many units you can assemble from current stock.',
  maxProducibleEmptyRecipe: 'Product has no recipe — add raw materials and components.',
  maxProducibleNoLimit: 'All items are factory-supplied — no material constraints.',
  maxProducibleLimitedBy: 'Limited by',
  maxProducibleWhyHeader: 'Why not more',
  maxProducibleZeroStock: 'No stock — zero units can be produced with current data.',
  maxProducibleSelectProducts: 'Select products',
  maxProducibleSelectAll: 'Select all',
  maxProducibleClearSelection: 'Clear',
  maxProducibleSelectedCount: 'selected',
  maxProducibleRefresh: 'Refresh',
  maxProducibleShowDetails: 'Show details',
  maxProducibleHideDetails: 'Hide details',
  bottleneckTag: 'bottleneck',
  perUnitLabel: 'Per unit',
  enoughFor: 'Enough for',
  compute: 'Compute',
  dashboardStartStep: 'Step 1',
  dashboardStartCta: 'Import stock',
  dashboardStartHint: 'Load xlsx exports from MP Firma — the starting point of the whole flow.',
  dashboardYourData: 'Your data',
  dashboardMissingItems: 'Missing items',
  dashboardNoMissing: 'No shortages — everything is in stock.',
  dashboardNoReportYet: 'No shortage report yet. Create a plan and compute shortages.',
  dashboardLastReport: 'Last report',
  dashboardSeeFullReport: 'See full report',
  dashboardShortageBy: 'By supplier',
  dashboardOrder: 'Order',
  dashboardWelcomeEyebrow: 'Cutis Production Planner',
  dashboardWelcomeMorning: 'Good morning',
  dashboardWelcomeAfternoon: 'Good afternoon',
  dashboardWelcomeEvening: 'Good evening',
  dashboardWelcomeNight: 'Burning the midnight oil?',
  dashboardWelcomeTagline: 'Plan production, spot shortages, send RFQ emails — all in one place.',
  dashboardWelcomeMottoIntro: 'Pracuj z uśmiechem i powtarzaj nasze motto:',
  dashboardWelcomeMotto: 'Od jednego strzała jeszcze nikt się nie uzależnił',
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
  adoptAllUnmatched: 'Add all unmatched ({n})',
  adoptAllConfirm: 'Create {n} new catalog entries from unmatched rows? Defaults: unit "kg" for raw materials, type "other" for components; no supplier. You can fill in details later in Raw materials/Components.',
  resolveRowTitle: 'Unrecognized item',
  resolveRowSubtitleRaw: 'Raw material from import — choose how to map it to the catalog.',
  resolveRowSubtitleComponent: 'Component from import — choose how to map it to the catalog.',
  resolveRowFromImport: 'From import',
  resolveRowSuggestions: 'Similar in catalog',
  resolveRowNoSuggestions: 'No close matches found in the catalog.',
  resolveRowSuggestionConfidence: 'similarity',
  resolveRowActionUseOnce: 'Use just for this import',
  resolveRowActionUseOnceHint: 'Link this row to the selected catalog entry, no permanent mapping.',
  resolveRowActionSaveAlias: 'Save alias permanently',
  resolveRowActionSaveAliasHint: 'Remember “{import}” as an alias of “{catalog}”. Future imports with that name will be matched automatically.',
  resolveRowActionRename: 'Rename in catalog',
  resolveRowActionRenameHint: 'Rename the catalog entry “{catalog}” to “{import}” (from the import). The old name will be kept as an alias so existing links keep working.',
  resolveRowActionAddNew: 'Add as new entry',
  resolveRowActionAddNewHint: 'Create a brand-new catalog entry using the import name.',
  resolveRowChooseSuggestion: 'Pick a catalog entry to map this row to.',
  resolveRowPickAction: 'Pick an action.',
  resolveRowProgress: 'Item {n} of {total}',
  resolveRowSkip: 'Skip',
  resolveRowDone: 'Done',
  resolveRowAliasAdded: 'Alias saved.',
  resolveRowRenameConfirm: 'Rename catalog entry “{catalog}” to “{import}”? The old name will be kept as an alias.',
  bulkResolveTitle: 'Unrecognized items ({n})',
  bulkSetAll: 'Set all to:',
  bulkColMapTo: 'Map to (catalog)',
  bulkColAction: 'Action',
  bulkPickTarget: '— pick —',
  bulkSkipRow: 'Skip this row (leave unmatched)',
  bulkUnskip: 'Restore',
  bulkSkipped: 'Skipped',
  bulkApplyAll: 'Apply all ({n})',
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
  exportCsv: 'Export CSV',
  importCsv: 'Import CSV',
  exportJson: 'Export JSON',
  importJson: 'Import JSON',
  exportLabel: 'Export',
  importLabel: 'Import',
  exportEmpty: 'Nothing to export',
  importInvalidFile: 'Failed to read file',
  nextStep: 'Next step',
  goToShortageReport: 'Go to shortage report',
  goToEmailGenerator: 'Go to email generator',
  selectPlanFirst: 'Select a plan to compute shortages',
  noPlansYet: 'No production plans yet',
  addPlanCta: 'Add production plan',
  addFirstPlanHint: 'Create your first production plan to schedule raw materials and components.',
  noProductsYet: 'No products yet',
  defineProductsFirstHint:
    'Define products (with recipes) first before you can create a production plan.',
  goToProductsCta: 'Go to products',
  olderReportsTitle: 'Earlier reports',
  olderReportsHint: 'History of computed shortages',
  computedAtLabel: 'Computed',
  deleteReportConfirm: 'Delete report',
  emailGeneratorHeroTitle: 'Generate RFQ emails',
  emailGeneratorHeroHint:
    'Pick a shortage report — it determines which suppliers will receive the quote requests.',
  selectShortageReportFirst: 'Select a shortage report',
  noShortageReportsYet: 'No shortage reports yet',
  goToShortageReportToCompute: 'Go to shortage report',
  shortageReportNoGroups: 'No shortages — there is no one to email.',
  olderEmailBatchesTitle: 'Earlier email batches',
  olderEmailBatchesHint: 'History of generated RFQs',
  generatedAtLabel: 'Generated',
  emailsCount: 'emails',
  sentCount: 'sent',
  markSent: 'Mark as sent',
  unmarkSent: 'Unmark sent',
  sentAtLabel: 'Sent',
  sentBadge: 'sent',
  deleteBatchConfirm: 'Delete email batch',
  emailBatchTitle: 'RFQ emails',
  navBack: 'Back',
  navForward: 'Forward',
  navHistory: 'Navigation',
  openPlan: 'Open plan',
  linkedPlanDeleted: 'The linked plan has been deleted and is no longer available.',
  linkedReportDeleted: 'The linked shortage report has been deleted and is no longer available.',
  linkedPlanDeletedTag: 'plan deleted',
  linkedReportDeletedTag: 'report deleted',
};

export const translations: Record<Lang, T> = { pl, en };
