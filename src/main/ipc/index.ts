import { ipcMain, dialog, shell, app, net, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { autoUpdater } from 'electron-updater';
import Database from '../database';
import log from '../utils/logger';
import { IPC } from '../../shared/ipcChannels';
import type {
  StoreSchema,
  StockKind,
  Lang,
  RawMaterialsImportMode,
  RecipeImportMode,
  RecipeImportResolutions,
  AppSettings,
  StockRow,
  StockSnapshot,
  ImportSummary,
  StockConflict,
  StockConflictResolution,
  StockSyncResult,
  MagazynStockDecision,
  MagazynStockCommitResult,
  MagazynStockUnmatched,
  PackagingComponent,
  RawStockDecision,
  RawStockCommitResult,
  RawStockAnalysis,
  RawStockUnmatched,
  StockBatch,
} from '../../shared/types';
import { getBackupsDir, getBackupStatus, validateBackup } from '../backupService';
import { parseStockXlsx } from '../services/xlsxStockImporter';
import { importRawMaterialsXlsx } from '../services/xlsxRawMaterialsImporter';
import { importComponentsXlsx, inferComponentType } from '../services/xlsxComponentsImporter';
import { analyzeMagazynStock } from '../services/magazynStockImporter';
import { analyzeRawStock } from '../services/magazynRawStockImporter';
import {
  analyzeRecipesXlsx,
  commitRecipesXlsx,
  exportRecipesXlsx,
} from '../services/recipesXlsxService';
import { matchOne } from '../services/matcher';
import { suggestMatches, normalize as normalizeAlias } from '../services/smartMatcher';
import { computeShortages, previewExpiredForPlan } from '../services/shortageCalculator';
import { reconcileStock } from '../services/stockReconciler';
import { computeCost } from '../services/costCalculator';
import { generateEmailsForReport, regenerateBatchEmail } from '../services/rfqGenerator';
import { maxProducible } from '../services/reverseCalculator';
import { isAiAvailable, getModel } from '../aiConfig';
import { rewriteEmail, suggestMatch } from '../services/llmClient';
import { seedDemo } from '../services/demoSeed';
import * as authService from '../authService';
import { getMigrationStatus, runMigration } from '../migrationService';
import {
  authenticate as bsxAuthenticate,
  fetchStockForWarehouse,
  fetchWarehouses as bsxFetchWarehouses,
  fetchLatestPzPrices,
  BsxError,
  type BsxStockRow,
  type BsxPzPrice,
} from '../services/bsxClient';
import {
  setPassword as bsxSetPassword,
  clearPassword as bsxClearPassword,
  resolveBsxConfig,
  exposedBsxSettings,
} from '../bsxConfig';
import { newId, nowIso } from '../utils/id';

// Runs the alias + fuzzy matching pipeline against a freshly built snapshot
// and persists it. Used by both the xlsx and the BSX import paths.
async function matchAndPersistSnapshot(
  db: Database,
  snapshot: StockSnapshot,
  kind: StockKind,
): Promise<{ matched: number; ambiguous: number; unmatched: number }> {
  const candidates =
    kind === 'raw'
      ? (await db.listRawMaterials()).map((r) => ({
          id: r.id,
          name: r.name,
          mpFirmaSymbol: r.mpFirmaSymbol,
        }))
      : (await db.listComponents()).map((c) => ({
          id: c.id,
          name: c.name,
          mpFirmaSymbol: c.mpFirmaSymbol,
        }));

  const aliases =
    kind === 'raw' ? await db.listRawMaterialAliases() : await db.listComponentAliases();
  const aliasMap = new Map<string, string>();
  for (const a of aliases) {
    aliasMap.set(normalizeAlias(a.alias), a.targetId);
  }

  let matched = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const row of snapshot.rows) {
    const aliasHit = aliasMap.get(normalizeAlias(row.name));
    if (aliasHit) {
      if (kind === 'raw') row.matchedRawMaterialId = aliasHit;
      else row.matchedComponentId = aliasHit;
      row.matchConfidence = 1;
      row.matchAmbiguous = false;
      matched++;
      if (typeof row.netPrice === 'number' && row.netPrice > 0) {
        if (kind === 'raw')
          await db.setRawMaterialLastPrice(aliasHit, row.netPrice, row.currency);
        else await db.setComponentLastPrice(aliasHit, row.netPrice, row.currency);
      }
      continue;
    }
    const result = matchOne({ name: row.name, mpFirmaSymbol: row.mpFirmaSymbol }, candidates);
    row.matchConfidence = result.confidence;
    row.matchAmbiguous = result.ambiguous;
    if (result.id && !result.ambiguous) {
      if (kind === 'raw') row.matchedRawMaterialId = result.id;
      else row.matchedComponentId = result.id;
      matched++;
      if (typeof row.netPrice === 'number' && row.netPrice > 0) {
        if (kind === 'raw')
          await db.setRawMaterialLastPrice(result.id, row.netPrice, row.currency);
        else await db.setComponentLastPrice(result.id, row.netPrice, row.currency);
      }
    } else if (result.ambiguous) {
      ambiguous++;
    } else {
      unmatched++;
    }
  }

  await db.addStockSnapshot(snapshot);
  // NOTE: catalog stock is NOT updated here. Applying imported quantities to the
  // catalog is an explicit, user-triggered step ("Synchronizuj stany" in the
  // stock import view) — see the STOCK_SYNC_CATALOG handler.
  return { matched, ambiguous, unmatched };
}

// Converts a BSX /mp/stock/list row into the app's internal StockRow. Prices
// come from the latest PZ document for this product (model A — ostatnia cena
// zakupu), looked up in `priceMap`; totals are derived as qty × unit price.
// If the product has no matching PZ in the same warehouse, prices stay
// undefined so the renderer surfaces the gap rather than silently zeroing.
function mapBsxRowToStockRow(
  row: BsxStockRow,
  priceMap: Map<string, BsxPzPrice>,
): StockRow {
  const qty = parseFloat(String(row.pquantity ?? '0'));
  const safeQty = Number.isFinite(qty) ? qty : 0;
  const symbol =
    (typeof row.psymbol === 'string' && row.psymbol.trim()) ||
    (typeof row.pcatsymbol === 'string' && row.pcatsymbol.trim()) ||
    undefined;
  const producer =
    (typeof row.pmansymbol === 'string' && row.pmansymbol.trim()) ||
    (typeof row.pproducent === 'string' && row.pproducent.trim()) ||
    undefined;

  const price = priceMap.get(String(row.id));
  const out: StockRow = {
    rowKey: `bsx:${row.id}`,
    name: String(row.pname ?? '').trim(),
    qty: safeQty,
    warehouse: (typeof row.idm_title === 'string' && row.idm_title) || undefined,
    mpFirmaSymbol: symbol || undefined,
    manufacturerSymbol: producer || undefined,
  };
  if (price) {
    out.netPrice = price.netPrice;
    out.vatPrice = price.vatPrice;
    out.grossPrice = price.grossPrice;
    out.currency = price.currency;
    out.oNet = safeQty * price.netPrice;
    out.oVat = safeQty * price.vatPrice;
    out.oGross = safeQty * price.grossPrice;
    // Record provenance in the notes column so the user can see which PZ a
    // price came from at a glance — helpful when the underlying invoice is
    // questioned.
    const supplier = price.supplier ? ` (${price.supplier})` : '';
    out.notes = `PZ ${price.pzNo || price.pzId} z ${price.pzDate}${supplier}`;
  }
  return out;
}

export function registerIpcHandlers(db: Database, getMainWindow: () => BrowserWindow | null): void {
  // ---- Suppliers ----
  ipcMain.handle(IPC.SUPPLIERS_LIST, () => db.listSuppliers());
  ipcMain.handle(IPC.SUPPLIERS_GET, (_e, id: string) => db.getSupplier(id));
  ipcMain.handle(IPC.SUPPLIERS_CREATE, (_e, input) => db.createSupplier(input));
  ipcMain.handle(IPC.SUPPLIERS_UPDATE, (_e, id: string, patch) => db.updateSupplier(id, patch));
  ipcMain.handle(IPC.SUPPLIERS_DELETE, (_e, id: string) => db.deleteSupplier(id));
  ipcMain.handle(IPC.SUPPLIERS_DUPLICATE, (_e, id: string) => db.duplicateSupplier(id));

  // ---- Raw materials ----
  ipcMain.handle(IPC.RAW_LIST, () => db.listRawMaterials());
  ipcMain.handle(IPC.RAW_GET, (_e, id: string) => db.getRawMaterial(id));
  ipcMain.handle(IPC.RAW_CREATE, (_e, input) => db.createRawMaterial(input));
  ipcMain.handle(IPC.RAW_UPDATE, (_e, id: string, patch) => db.updateRawMaterial(id, patch));
  ipcMain.handle(IPC.RAW_DELETE, (_e, id: string) => db.deleteRawMaterial(id));
  ipcMain.handle(IPC.RAW_DUPLICATE, (_e, id: string) => db.duplicateRawMaterial(id));

  ipcMain.handle(IPC.RAW_XLSX_IMPORT, async (_e, mode: RawMaterialsImportMode) => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: 'Wybierz plik z surowcami (xlsx)',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    try {
      const summary = await importRawMaterialsXlsx(result.filePaths[0], mode, db);
      db.updateSettings({ lastImportDir: path.dirname(result.filePaths[0]) });
      return { ok: true, summary };
    } catch (err) {
      log.error('[raw-materials-import] failed:', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Warehouse stock import ("Magazyn.xlsx" → "Stan surowców"). Two-phase:
  // analyze parses + matches by name and groups each material's rows into
  // expiry batches (no writes); the renderer resolves any Σ(C)≠D mismatches;
  // commit writes the batches. Only matched materials are touched.
  ipcMain.handle(IPC.RAW_MAGAZYN_STOCK_ANALYZE, async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: 'Wybierz plik magazynu (xlsx) — zakładka „Stan surowców”',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    try {
      const analysis = await analyzeRawStock(result.filePaths[0], db);
      db.updateSettings({ lastImportDir: path.dirname(result.filePaths[0]) });
      return { ok: true, analysis };
    } catch (err) {
      log.error('[magazyn-raw] analyze failed:', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Apply the raw-stock decisions. Consistent materials (Σ(C)==D) import
  // silently; mismatched ones import only when the user chose 'take'. Importing
  // writes the expiry batches, sets stockQty to their sum, and stamps the item
  // as an import (source file + today's date).
  ipcMain.handle(
    IPC.RAW_MAGAZYN_STOCK_COMMIT,
    async (
      _e,
      args: {
        sourceFile: string;
        analysis: RawStockAnalysis;
        decisions: RawStockDecision[];
        // Unmatched materials the user chose to create as new catalog entries.
        createItems?: RawStockUnmatched[];
      },
    ): Promise<RawStockCommitResult> => {
      const decisionMap = new Map(args.decisions.map((d) => [d.itemId, d.action]));
      const out: RawStockCommitResult = { imported: 0, rejected: 0, created: 0 };
      const now = nowIso();
      const toBatches = (rows: RawStockUnmatched['batches']): StockBatch[] =>
        rows.map((b) => ({
          id: newId(),
          qty: b.qty,
          productionDate: b.productionDate,
          expiryDate: b.expiryDate,
          microTestDate: b.microTestDate,
          retestExpiryDate: b.retestExpiryDate,
          note: b.note,
        }));

      for (const m of args.analysis.matches) {
        // Mismatched materials need an explicit decision (default: reject);
        // consistent ones always import.
        const action = m.sumMismatch ? (decisionMap.get(m.itemId) ?? 'reject') : 'take';
        if (action === 'reject') {
          out.rejected++;
          continue;
        }
        const batches = toBatches(m.batches);
        const total = batches.reduce((s, b) => s + b.qty, 0);
        await db.updateRawMaterial(m.itemId, {
          stockBatches: batches,
          stockQty: total,
          stockSource: 'import',
          stockSourceFile: args.sourceFile,
          stockUpdatedAt: now,
        });
        out.imported++;
      }

      // Create the unmatched materials the user opted to add (unit defaults to
      // kg; no supplier/price — those are filled in later by the user).
      for (const u of args.createItems ?? []) {
        const batches = toBatches(u.batches);
        const total = batches.reduce((s, b) => s + b.qty, 0);
        await db.createRawMaterial({
          name: u.name,
          unit: u.unit,
          supplierIds: [],
          factorySupplied: false,
          stockBatches: batches,
          stockQty: total,
          stockSource: 'import',
          stockSourceFile: args.sourceFile,
          stockUpdatedAt: now,
        });
        out.created++;
      }
      return out;
    },
  );

  // ---- Components ----
  ipcMain.handle(IPC.COMP_LIST, () => db.listComponents());
  ipcMain.handle(IPC.COMP_GET, (_e, id: string) => db.getComponent(id));
  ipcMain.handle(IPC.COMP_CREATE, (_e, input) => db.createComponent(input));
  ipcMain.handle(IPC.COMP_UPDATE, (_e, id: string, patch) => db.updateComponent(id, patch));
  ipcMain.handle(IPC.COMP_DELETE, (_e, id: string) => db.deleteComponent(id));
  ipcMain.handle(IPC.COMP_DUPLICATE, (_e, id: string) => db.duplicateComponent(id));

  ipcMain.handle(IPC.COMP_XLSX_IMPORT, async (_e, mode: RawMaterialsImportMode) => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: 'Wybierz plik z komponentami (xlsx)',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    try {
      const summary = await importComponentsXlsx(result.filePaths[0], mode, db);
      db.updateSettings({ lastImportDir: path.dirname(result.filePaths[0]) });
      return { ok: true, summary };
    } catch (err) {
      log.error('[components-import] failed:', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Warehouse stock import ("Magazyn.xlsx" → "Stan komponentów"). Two-phase:
  // analyze shows the file picker + matches rows to existing components (no
  // writes); the renderer resolves per-item quantity differences; commit
  // applies them. Only matched components are touched — extra rows are ignored.
  ipcMain.handle(IPC.COMP_MAGAZYN_STOCK_ANALYZE, async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: 'Wybierz plik magazynu (xlsx) — zakładka „Stan komponentów”',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    try {
      const analysis = await analyzeMagazynStock(result.filePaths[0], db);
      db.updateSettings({ lastImportDir: path.dirname(result.filePaths[0]) });
      return { ok: true, analysis };
    } catch (err) {
      log.error('[magazyn-stock] analyze failed:', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Apply the user's decisions. `note` is written for every matched item that
  // carries one (regardless of the keep/take choice); `action: 'take'`
  // additionally overwrites the stock from column C and stamps it as an import
  // (source file + today's date), so the catalog shows when it came from.
  ipcMain.handle(
    IPC.COMP_MAGAZYN_STOCK_COMMIT,
    async (
      _e,
      args: {
        sourceFile: string;
        decisions: MagazynStockDecision[];
        // Unmatched file rows the user chose to create as new components.
        createItems?: MagazynStockUnmatched[];
      },
    ): Promise<MagazynStockCommitResult> => {
      const out: MagazynStockCommitResult = {
        stockUpdated: 0,
        notesUpdated: 0,
        kept: 0,
        created: 0,
      };
      const now = nowIso();
      for (const d of args.decisions) {
        const existing = await db.getComponent(d.itemId);
        if (!existing) continue;
        const patch: Partial<PackagingComponent> = {};

        // Notes always follow the file when it provides one; an empty cell
        // leaves any existing note untouched (never wipes a manual note).
        const note = d.note?.trim();
        if (note && note !== (existing.stockNote ?? '')) {
          patch.stockNote = note;
          out.notesUpdated++;
        }

        if (d.action === 'take') {
          patch.stockQty = d.importedQty;
          patch.stockSource = 'import';
          patch.stockSourceFile = args.sourceFile;
          patch.stockUpdatedAt = now;
          out.stockUpdated++;
        } else {
          out.kept++;
        }

        if (Object.keys(patch).length > 0) await db.updateComponent(d.itemId, patch);
      }

      // Create the unmatched rows the user opted to add. The type is inferred
      // from the name (as in the components-file import); stock/note come from
      // the row. No supplier/price — the user fills those in later.
      for (const u of args.createItems ?? []) {
        await db.createComponent({
          name: u.name,
          type: inferComponentType(u.name),
          supplierIds: [],
          stockQty: u.qty,
          stockSource: 'import',
          stockSourceFile: args.sourceFile,
          stockUpdatedAt: now,
          stockNote: u.note?.trim() || undefined,
        });
        out.created++;
      }
      return out;
    },
  );

  // ---- Products ----
  ipcMain.handle(IPC.PRODUCTS_LIST, () => db.listProducts());
  ipcMain.handle(IPC.PRODUCTS_GET, (_e, id: string) => db.getProduct(id));
  ipcMain.handle(IPC.PRODUCTS_CREATE, (_e, input) => db.createProduct(input));
  ipcMain.handle(IPC.PRODUCTS_UPDATE, (_e, id: string, patch) => db.updateProduct(id, patch));
  ipcMain.handle(IPC.PRODUCTS_DELETE, (_e, id: string) => db.deleteProduct(id));
  ipcMain.handle(IPC.PRODUCTS_DUPLICATE, (_e, id: string) => db.duplicateProduct(id));

  // Two-phase recipe import. The analyze call shows the file picker and
  // returns the list of catalog items the file references but the catalog
  // can't resolve, so the renderer can prompt the user per item. The commit
  // call carries the user's decisions and performs the actual import.
  ipcMain.handle(IPC.PRODUCTS_RECIPES_XLSX_ANALYZE, async (_e, mode: RecipeImportMode) => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: 'Wybierz plik z recepturami (xlsx)',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    try {
      const analysis = await analyzeRecipesXlsx(result.filePaths[0], mode, db);
      db.updateSettings({ lastImportDir: path.dirname(result.filePaths[0]) });
      return { ok: true, analysis };
    } catch (err) {
      log.error('[recipes-analyze] failed:', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    IPC.PRODUCTS_RECIPES_XLSX_COMMIT,
    async (
      _e,
      args: { filePath: string; mode: RecipeImportMode; resolutions: RecipeImportResolutions },
    ) => {
      try {
        const summary = await commitRecipesXlsx(args.filePath, args.mode, args.resolutions, db);
        return { ok: true, summary };
      } catch (err) {
        log.error('[recipes-commit] failed:', err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(IPC.PRODUCTS_RECIPES_XLSX_EXPORT, async () => {
    const win = getMainWindow();
    const result = await dialog.showSaveDialog(win!, {
      title: 'Eksportuj receptury (xlsx)',
      defaultPath: `Plik z recepturami ${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    try {
      await exportRecipesXlsx(result.filePath, db);
      return { ok: true, path: result.filePath };
    } catch (err) {
      log.error('[recipes-export] failed:', err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---- Stock ----
  ipcMain.handle(IPC.STOCK_SELECT_FILES, async () => {
    const win = getMainWindow();
    const rawResult = await dialog.showOpenDialog(win!, {
      title: 'Wybierz eksport surowców (xlsx)',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    const compResult = await dialog.showOpenDialog(win!, {
      title: 'Wybierz eksport komponentów (xlsx)',
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      properties: ['openFile'],
    });
    return {
      rawPath: rawResult.canceled ? undefined : rawResult.filePaths[0],
      componentPath: compResult.canceled ? undefined : compResult.filePaths[0],
    };
  });

  ipcMain.handle(
    IPC.STOCK_IMPORT,
    async (
      _e,
      args: { rawPath?: string; componentPath?: string },
    ) => {
      const snapshotIds: string[] = [];
      let matched = 0;
      let ambiguous = 0;
      let unmatched = 0;
      let rawCount: number | undefined;
      let componentCount: number | undefined;

      const importFile = async (filePath: string, kind: StockKind) => {
        const snapshot = await parseStockXlsx(filePath, kind);
        const counts = await matchAndPersistSnapshot(db, snapshot, kind);
        matched += counts.matched;
        ambiguous += counts.ambiguous;
        unmatched += counts.unmatched;
        snapshotIds.push(snapshot.id);
        if (kind === 'raw') rawCount = snapshot.rows.length;
        else componentCount = snapshot.rows.length;
      };

      if (args.rawPath) {
        try {
          await importFile(args.rawPath, 'raw');
          db.updateSettings({ lastImportDir: path.dirname(args.rawPath) });
        } catch (err) {
          log.error('[stock-import] raw failed:', err);
          throw err;
        }
      }
      if (args.componentPath) {
        try {
          await importFile(args.componentPath, 'component');
          db.updateSettings({ lastImportDir: path.dirname(args.componentPath) });
        } catch (err) {
          log.error('[stock-import] component failed:', err);
          throw err;
        }
      }

      return { snapshotIds, rawCount, componentCount, matched, ambiguous, unmatched };
    },
  );

  // Phase A: pull stock state only. Fast (~2-3s for both warehouses) and
  // sufficient for the renderer to show qty/name/match immediately. Prices
  // are filled in by Phase B (STOCK_LOAD_BSX_PRICES), which the renderer
  // kicks off right after this resolves.
  ipcMain.handle(IPC.STOCK_IMPORT_BSX, async (): Promise<ImportSummary> => {
    const cfg = resolveBsxConfig(db);
    const session = await bsxAuthenticate(cfg.cloudKey, cfg.username, cfg.password);
    const [rawRows, compRows] = await Promise.all([
      fetchStockForWarehouse(session.sessionToken, cfg.rawIdstock),
      fetchStockForWarehouse(session.sessionToken, cfg.componentIdstock),
    ]);
    const stamp = nowIso();
    const emptyPriceMap = new Map<string, BsxPzPrice>();

    const buildSnapshot = (
      bsxRows: BsxStockRow[],
      kind: StockKind,
      idstock: number,
    ): StockSnapshot => ({
      id: newId(),
      importedAt: stamp,
      sourceFile: `BSX idstock=${idstock}`,
      kind,
      rows: bsxRows.map((r) => mapBsxRowToStockRow(r, emptyPriceMap)),
    });

    const rawSnap = buildSnapshot(rawRows, 'raw', cfg.rawIdstock);
    const compSnap = buildSnapshot(compRows, 'component', cfg.componentIdstock);

    const snapshotIds: string[] = [];
    let matched = 0;
    let ambiguous = 0;
    let unmatched = 0;

    const rawCounts = await matchAndPersistSnapshot(db, rawSnap, 'raw');
    snapshotIds.push(rawSnap.id);
    matched += rawCounts.matched;
    ambiguous += rawCounts.ambiguous;
    unmatched += rawCounts.unmatched;

    const compCounts = await matchAndPersistSnapshot(db, compSnap, 'component');
    snapshotIds.push(compSnap.id);
    matched += compCounts.matched;
    ambiguous += compCounts.ambiguous;
    unmatched += compCounts.unmatched;

    return {
      snapshotIds,
      rawCount: rawSnap.rows.length,
      componentCount: compSnap.rows.length,
      matched,
      ambiguous,
      unmatched,
    };
  });

  ipcMain.handle(IPC.BSX_TEST_CONNECTION, async () => {
    try {
      const cfg = resolveBsxConfig(db);
      await bsxAuthenticate(cfg.cloudKey, cfg.username, cfg.password);
      return { ok: true as const };
    } catch (err) {
      const msg = err instanceof BsxError ? err.message : (err as Error).message;
      log.warn('[bsx] test connection failed:', msg);
      return { ok: false as const, error: msg };
    }
  });

  ipcMain.handle(IPC.BSX_SET_PASSWORD, (_e, password: string) => {
    if (typeof password !== 'string' || password.length === 0) {
      throw new Error('Password must be a non-empty string');
    }
    bsxSetPassword(password);
    return { ok: true };
  });

  ipcMain.handle(IPC.BSX_CLEAR_PASSWORD, () => {
    bsxClearPassword();
    return { ok: true };
  });

  // Phase B: backfills purchase prices into snapshots created by Phase A.
  // The renderer kicks this off right after STOCK_IMPORT_BSX resolves so the
  // expensive PZ scan (~30-60s) happens with the stock already visible on
  // screen. Patches are computed up-front from the price map keyed by
  // BSX idproduct → StockRow.rowKey="bsx:${idproduct}"; rows whose product
  // has no matching PZ are left untouched.
  ipcMain.handle(
    IPC.STOCK_LOAD_BSX_PRICES,
    async (
      _e,
      snapshotIds: { raw?: string; component?: string },
    ): Promise<{ ok: true; raw: number; component: number } | { ok: false; error: string }> => {
      try {
        const cfg = resolveBsxConfig(db);
        const session = await bsxAuthenticate(cfg.cloudKey, cfg.username, cfg.password);
        const [rawPrices, compPrices] = await Promise.all([
          snapshotIds.raw
            ? fetchLatestPzPrices(session.sessionToken, cfg.rawIdstock)
            : Promise.resolve(new Map<string, BsxPzPrice>()),
          snapshotIds.component
            ? fetchLatestPzPrices(session.sessionToken, cfg.componentIdstock)
            : Promise.resolve(new Map<string, BsxPzPrice>()),
        ]);

        const buildPatches = (
          priceMap: Map<string, BsxPzPrice>,
        ): Map<string, Partial<StockRow>> => {
          // We don't know the qty for each row from here, so oNet/oVat/oGross
          // are computed by Phase A having been called with qty already. We
          // patch the unit prices here and re-derive totals from qty in
          // updateSnapshotRows — but db doesn't read the row to derive, so
          // we have to do it. Build a closure that reads qty from snapshot
          // rows is the only honest way; pre-read snapshot for that.
          const patches = new Map<string, Partial<StockRow>>();
          for (const [idproduct, price] of priceMap) {
            const supplier = price.supplier ? ` (${price.supplier})` : '';
            patches.set(`bsx:${idproduct}`, {
              netPrice: price.netPrice,
              vatPrice: price.vatPrice,
              grossPrice: price.grossPrice,
              currency: price.currency,
              notes: `PZ ${price.pzNo || price.pzId} z ${price.pzDate}${supplier}`,
            });
          }
          return patches;
        };

        const applyToSnapshot = async (
          snapshotId: string | undefined,
          priceMap: Map<string, BsxPzPrice>,
        ): Promise<number> => {
          if (!snapshotId) return 0;
          // Pre-read so we can compute per-row totals (qty × unit price).
          const snap = await db.getStockSnapshotById(snapshotId);
          if (!snap) return 0;
          const patches = new Map<string, Partial<StockRow>>();
          for (const row of snap.rows) {
            if (!row.rowKey.startsWith('bsx:')) continue;
            const price = priceMap.get(row.rowKey.slice(4));
            if (!price) continue;
            const supplier = price.supplier ? ` (${price.supplier})` : '';
            patches.set(row.rowKey, {
              netPrice: price.netPrice,
              vatPrice: price.vatPrice,
              grossPrice: price.grossPrice,
              currency: price.currency,
              oNet: row.qty * price.netPrice,
              oVat: row.qty * price.vatPrice,
              oGross: row.qty * price.grossPrice,
              notes: `PZ ${price.pzNo || price.pzId} z ${price.pzDate}${supplier}`,
            });
          }
          // buildPatches is kept above for future "skip pre-read" optimization;
          // for now we use the row-aware version.
          void buildPatches;
          const res = await db.updateSnapshotRows(snapshotId, patches);
          return res?.updated ?? 0;
        };

        const [rawUpdated, compUpdated] = await Promise.all([
          applyToSnapshot(snapshotIds.raw, rawPrices),
          applyToSnapshot(snapshotIds.component, compPrices),
        ]);
        return { ok: true, raw: rawUpdated, component: compUpdated };
      } catch (err) {
        const msg = err instanceof BsxError ? err.message : (err as Error).message;
        log.warn('[bsx] load prices failed:', msg);
        return { ok: false, error: msg };
      }
    },
  );

  ipcMain.handle(IPC.BSX_LIST_WAREHOUSES, async () => {
    try {
      const cfg = resolveBsxConfig(db);
      const session = await bsxAuthenticate(cfg.cloudKey, cfg.username, cfg.password);
      const warehouses = await bsxFetchWarehouses(session.sessionToken);
      return { ok: true as const, warehouses };
    } catch (err) {
      const msg = err instanceof BsxError ? err.message : (err as Error).message;
      log.warn('[bsx] list warehouses failed:', msg);
      return { ok: false as const, error: msg };
    }
  });

  ipcMain.handle(IPC.STOCK_LIST_SNAPSHOTS, () => db.listStockSnapshots());
  ipcMain.handle(IPC.STOCK_GET_CURRENT, async () => {
    const rawSnap = await db.getCurrentSnapshot('raw');
    const compSnap = await db.getCurrentSnapshot('component');
    return {
      raw: rawSnap?.rows ?? [],
      components: compSnap?.rows ?? [],
      rawSnapshot: rawSnap
        ? { id: rawSnap.id, importedAt: rawSnap.importedAt, sourceFile: rawSnap.sourceFile }
        : null,
      componentSnapshot: compSnap
        ? { id: compSnap.id, importedAt: compSnap.importedAt, sourceFile: compSnap.sourceFile }
        : null,
    };
  });
  ipcMain.handle(
    IPC.STOCK_RESOLVE_MATCH,
    async (_e, snapshotId: string, rowKey: string, targetKind: 'raw' | 'component', targetId: string) => {
      await db.updateSnapshotRowMatch(snapshotId, rowKey, targetKind, targetId);
      // Catalog stock is not touched here — the user syncs it explicitly via
      // STOCK_SYNC_CATALOG after resolving matches.
      return { ok: true };
    },
  );
  // Explicit, user-triggered sync: applies the current snapshots' matched
  // quantities to the catalog stock. Non-conflicting items are overwritten
  // silently; manually-edited items that disagree come back as conflicts for the
  // user to resolve. Runs both kinds (raw + component) in one call.
  ipcMain.handle(IPC.STOCK_SYNC_CATALOG, async (): Promise<StockSyncResult> => {
    let applied = 0;
    const conflicts: StockConflict[] = [];
    const rawSnap = await db.getCurrentSnapshot('raw');
    if (rawSnap) {
      const r = await reconcileStock(db, rawSnap, 'raw');
      applied += r.applied;
      conflicts.push(...r.conflicts);
    }
    const compSnap = await db.getCurrentSnapshot('component');
    if (compSnap) {
      const r = await reconcileStock(db, compSnap, 'component');
      applied += r.applied;
      conflicts.push(...r.conflicts);
    }
    return { applied, conflicts };
  });
  // Apply user decisions from the import conflict dialog. 'take' overwrites the
  // manual value with the import value (source flips back to 'import'); 'keep'
  // leaves the manual value untouched.
  ipcMain.handle(
    IPC.STOCK_RESOLVE_CONFLICTS,
    async (_e, resolutions: StockConflictResolution[]) => {
      for (const r of resolutions) {
        if (r.action !== 'take') continue;
        if (r.kind === 'raw') {
          await db.setRawMaterialStock(r.itemId, {
            qty: r.importedQty,
            source: 'import',
            sourceFile: r.importSourceFile,
          });
        } else {
          await db.setComponentStock(r.itemId, {
            qty: r.importedQty,
            source: 'import',
            sourceFile: r.importSourceFile,
          });
        }
      }
      return { ok: true };
    },
  );
  // Manual stock edit from the catalog views — flags the item as 'manual' so
  // later imports raise a conflict instead of silently overwriting it.
  ipcMain.handle(
    IPC.STOCK_SET_MANUAL,
    async (_e, kind: StockKind, itemId: string, qty: number) => {
      return kind === 'raw'
        ? db.setRawMaterialStock(itemId, { qty, source: 'manual' })
        : db.setComponentStock(itemId, { qty, source: 'manual' });
    },
  );
  ipcMain.handle(
    IPC.STOCK_UPDATE_ROW,
    (_e, snapshotId: string, rowKey: string, patch: Record<string, unknown>) =>
      db.updateSnapshotRow(snapshotId, rowKey, patch),
  );
  ipcMain.handle(
    IPC.STOCK_DELETE_ROW,
    (_e, snapshotId: string, rowKey: string) => db.deleteSnapshotRow(snapshotId, rowKey),
  );
  ipcMain.handle(IPC.STOCK_DELETE_SNAPSHOT, (_e, snapshotId: string) =>
    db.deleteSnapshot(snapshotId),
  );
  ipcMain.handle(IPC.STOCK_DELETE_KIND, (_e, kind: StockKind) =>
    db.deleteSnapshotsByKind(kind),
  );
  ipcMain.handle(
    IPC.STOCK_SUGGEST_MATCHES,
    async (
      _e,
      kind: StockKind,
      source: { name: string; mpFirmaSymbol?: string },
      limit?: number,
    ) => {
      // Build candidate list with stored aliases attached so the matcher can
      // score a row against alias names too (e.g. "Spirual" stored as alias on
      // "Spirualit" should bump the latter to the top).
      const aliases =
        kind === 'raw' ? await db.listRawMaterialAliases() : await db.listComponentAliases();
      const aliasByTarget = new Map<string, string[]>();
      for (const a of aliases) {
        const arr = aliasByTarget.get(a.targetId) ?? [];
        arr.push(a.alias);
        aliasByTarget.set(a.targetId, arr);
      }
      const baseCandidates =
        kind === 'raw'
          ? (await db.listRawMaterials()).map((r) => ({ id: r.id, name: r.name, mpFirmaSymbol: r.mpFirmaSymbol }))
          : (await db.listComponents()).map((c) => ({ id: c.id, name: c.name, mpFirmaSymbol: c.mpFirmaSymbol }));
      const candidates = baseCandidates.map((c) => ({
        ...c,
        aliases: aliasByTarget.get(c.id),
      }));
      return suggestMatches(source, candidates, { limit: limit ?? 3 });
    },
  );

  // ---- Catalog aliases (raw materials + components) ----
  ipcMain.handle(IPC.RAW_ALIAS_LIST, () => db.listRawMaterialAliases());
  ipcMain.handle(IPC.RAW_ALIAS_ADD, (_e, targetId: string, alias: string) =>
    db.addRawMaterialAlias(targetId, alias),
  );
  ipcMain.handle(IPC.RAW_ALIAS_DELETE, (_e, id: string) => db.deleteRawMaterialAlias(id));
  ipcMain.handle(IPC.COMP_ALIAS_LIST, () => db.listComponentAliases());
  ipcMain.handle(IPC.COMP_ALIAS_ADD, (_e, targetId: string, alias: string) =>
    db.addComponentAlias(targetId, alias),
  );
  ipcMain.handle(IPC.COMP_ALIAS_DELETE, (_e, id: string) => db.deleteComponentAlias(id));

  // ---- Plan ----
  ipcMain.handle(IPC.PLAN_LIST, () => db.listPlans());
  ipcMain.handle(IPC.PLAN_GET, (_e, id: string) => db.getPlan(id));
  ipcMain.handle(IPC.PLAN_CREATE, (_e, input) => db.createPlan(input));
  ipcMain.handle(IPC.PLAN_UPDATE, (_e, id: string, patch) => db.updatePlan(id, patch));
  ipcMain.handle(IPC.PLAN_DELETE, (_e, id: string) => db.deletePlan(id));
  ipcMain.handle(IPC.PLAN_DUPLICATE, (_e, id: string) => db.duplicatePlan(id));
  ipcMain.handle(
    IPC.PLAN_COMPUTE_SHORTAGES,
    async (_e, planId: string, orderId?: string, includeExpiredBatchIds?: string[]) => {
      const report = await computeShortages(planId, db, includeExpiredBatchIds ?? []);
      await db.updatePlan(planId, { status: 'computed', computedAt: report.computedAt });
      await db.addShortageReport(planId, report, orderId);
      return report;
    },
  );
  // Pre-pass for the expired-stock prompt: expired batches relevant to the plan,
  // without computing or saving a report.
  ipcMain.handle(IPC.PLAN_PREVIEW_EXPIRED, (_e, planId: string) =>
    previewExpiredForPlan(planId, db),
  );

  // ---- Shortage report history ----
  ipcMain.handle(IPC.SHORTAGE_REPORT_LIST, () => db.listShortageReports());
  ipcMain.handle(IPC.SHORTAGE_REPORT_GET, (_e, id: string) => db.getShortageReport(id));
  ipcMain.handle(IPC.SHORTAGE_REPORT_DELETE, (_e, id: string) => db.deleteShortageReport(id));
  ipcMain.handle(
    IPC.SHORTAGE_REPORT_UPDATE,
    (
      _e,
      id: string,
      patch: { reportName?: string; orderId?: string | null; archived?: boolean },
    ) => db.updateShortageReport(id, patch),
  );
  ipcMain.handle(
    IPC.SHORTAGE_REPORT_SET_SUPPLIER_RECEIVED,
    (_e, reportId: string, supplierId: string, receivedAt: string | null) =>
      db.setReportSupplierReceived(reportId, supplierId, receivedAt),
  );
  ipcMain.handle(IPC.PLAN_COMPUTE_COST, (_e, planId: string) => computeCost(planId, db));

  // ---- Email batch history ----
  ipcMain.handle(
    IPC.EMAIL_BATCH_CREATE,
    async (
      _e,
      reportId: string,
      opts: { language: Lang; useAI: boolean; sendToAllAlternatives?: boolean },
    ) => generateEmailsForReport(reportId, opts, db),
  );
  ipcMain.handle(IPC.EMAIL_BATCH_LIST, () => db.listEmailBatches());
  ipcMain.handle(IPC.EMAIL_BATCH_GET, (_e, id: string) => db.getEmailBatch(id));
  ipcMain.handle(IPC.EMAIL_BATCH_DELETE, (_e, id: string) => db.deleteEmailBatch(id));
  ipcMain.handle(
    IPC.EMAIL_BATCH_UPDATE,
    (_e, id: string, patch: { batchName?: string; orderId?: string | null }) =>
      db.updateEmailBatch(id, patch),
  );
  ipcMain.handle(
    IPC.EMAIL_BATCH_UPDATE_EMAIL,
    (
      _e,
      batchId: string,
      emailId: string,
      patch: {
        body?: string;
        subject?: string;
        supplierId?: string;
        supplierName?: string;
        to?: string;
      },
    ) => db.updateBatchEmail(batchId, emailId, patch),
  );
  ipcMain.handle(
    IPC.EMAIL_BATCH_MARK_SENT,
    (_e, batchId: string, emailId: string, sentAt: string | null) =>
      db.markEmailSent(batchId, emailId, sentAt),
  );
  ipcMain.handle(
    IPC.EMAIL_BATCH_REGENERATE_EMAIL,
    async (
      _e,
      batchId: string,
      emailId: string,
      opts: { language: Lang; useAI: boolean },
    ) => regenerateBatchEmail(batchId, emailId, opts, db),
  );

  // ---- Workflow templates ----
  ipcMain.handle(IPC.WORKFLOW_TEMPLATE_LIST, () => db.listWorkflowTemplates());
  ipcMain.handle(IPC.WORKFLOW_TEMPLATE_GET, (_e, id: string) => db.getWorkflowTemplate(id));
  ipcMain.handle(IPC.WORKFLOW_TEMPLATE_CREATE, (_e, input) =>
    db.createWorkflowTemplate(input),
  );
  ipcMain.handle(IPC.WORKFLOW_TEMPLATE_UPDATE, (_e, id: string, patch) =>
    db.updateWorkflowTemplate(id, patch),
  );
  ipcMain.handle(IPC.WORKFLOW_TEMPLATE_DELETE, (_e, id: string) =>
    db.deleteWorkflowTemplate(id),
  );
  ipcMain.handle(IPC.WORKFLOW_TEMPLATE_DUPLICATE, (_e, id: string) =>
    db.duplicateWorkflowTemplate(id),
  );

  // ---- Orders ----
  ipcMain.handle(IPC.ORDERS_LIST, () => db.listOrders());
  ipcMain.handle(IPC.ORDERS_GET, (_e, id: string) => db.getOrder(id));
  ipcMain.handle(IPC.ORDERS_CREATE, (_e, input) => db.createOrder(input));
  ipcMain.handle(IPC.ORDERS_UPDATE, (_e, id: string, patch) => db.updateOrder(id, patch));
  ipcMain.handle(IPC.ORDERS_DELETE, (_e, id: string) => db.deleteOrder(id));
  ipcMain.handle(IPC.ORDERS_DUPLICATE, (_e, id: string) => db.duplicateOrder(id));
  ipcMain.handle(
    IPC.ORDERS_ATTACH_WORKFLOW,
    (_e, orderId: string, templateId: string) =>
      db.attachWorkflowToOrder(orderId, templateId),
  );
  ipcMain.handle(IPC.ORDERS_DETACH_WORKFLOW, (_e, orderId: string) =>
    db.detachWorkflowFromOrder(orderId),
  );
  ipcMain.handle(
    IPC.ORDERS_UPDATE_TASK,
    (_e, orderId: string, taskId: string, patch) =>
      db.updateOrderTask(orderId, taskId, patch),
  );
  ipcMain.handle(
    IPC.ORDERS_ADD_TASK,
    (_e, orderId: string, input, insertAtIndex?: number) =>
      db.addOrderTask(orderId, input, insertAtIndex),
  );
  ipcMain.handle(IPC.ORDERS_DELETE_TASK, (_e, orderId: string, taskId: string) =>
    db.deleteOrderTask(orderId, taskId),
  );
  ipcMain.handle(
    IPC.ORDERS_REORDER_TASKS,
    (_e, orderId: string, fromIndex: number, toIndex: number) =>
      db.reorderOrderTasks(orderId, fromIndex, toIndex),
  );

  // ---- Reverse ----
  ipcMain.handle(
    IPC.REVERSE_MAX_PRODUCIBLE,
    (_e, productId: string, includeExpiredBatchIds?: string[]) =>
      maxProducible(productId, db, includeExpiredBatchIds ?? []),
  );

  // ---- Settings ----
  const withBsxFlags = (s: AppSettings): AppSettings => ({
    ...s,
    bsx: exposedBsxSettings(s.bsx),
  });
  ipcMain.handle(IPC.SETTINGS_GET, () => withBsxFlags(db.getSettings()));
  ipcMain.handle(IPC.SETTINGS_UPDATE, (_e, patch: Partial<AppSettings>) => {
    // Renderer-side hasPassword is read-only; strip it before persisting so we
    // never serialize the derived flag into electron-store.
    if (patch.bsx && 'hasPassword' in patch.bsx) {
      const { hasPassword: _unused, ...rest } = patch.bsx;
      patch = { ...patch, bsx: rest };
    }
    return withBsxFlags(db.updateSettings(patch));
  });

  // ---- Overage ("naddatek") bulk action ----
  ipcMain.handle(
    IPC.OVERAGE_SET_FOR_ALL,
    (_e, kind: 'raw' | 'component', pct: number | null) => db.setOveragePctForAll(kind, pct),
  );

  // ---- Backup ----
  ipcMain.handle(IPC.BACKUP_EXPORT, async () => {
    const win = getMainWindow();
    const result = await dialog.showSaveDialog(win!, {
      title: 'Eksport danych',
      defaultPath: `cutis-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    const data = await db.exportAll(app.getVersion());
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle(IPC.BACKUP_IMPORT, async (_e, mode: 'merge' | 'replace') => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import danych',
      defaultPath: getBackupsDir(),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const parsed = validateBackup(JSON.parse(raw));
      // Snapshot the current state before it's replaced, so a restore of the
      // wrong file is itself recoverable from the backups folder.
      const preRestore = await db.exportAll(app.getVersion());
      const dir = getBackupsDir();
      fs.mkdirSync(dir, { recursive: true });
      const safetyPath = path.join(dir, `pre-restore-${Date.now()}.json`);
      fs.writeFileSync(safetyPath, JSON.stringify(preRestore, null, 2), 'utf-8');
      log.info(`[BACKUP] Pre-restore safety copy: ${safetyPath}`);

      const out = await db.importAll(parsed, mode);
      log.info(`[BACKUP] Restored from: ${result.filePaths[0]} (${mode})`);
      return { ok: true, applied: out.applied };
    } catch (error) {
      log.error('[BACKUP] Restore failed:', error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC.BACKUP_GET_STATUS, () => getBackupStatus());

  ipcMain.handle(IPC.BACKUP_OPEN_FOLDER, () => {
    const dir = getBackupsDir();
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return { ok: true };
  });

  // ---- Generic file save/open (per-view CSV/JSON export/import) ----
  ipcMain.handle(
    IPC.FILE_SAVE_TEXT,
    async (
      _e,
      args: {
        defaultName: string;
        content: string;
        title?: string;
        filters?: { name: string; extensions: string[] }[];
      },
    ) => {
      const win = getMainWindow();
      const result = await dialog.showSaveDialog(win!, {
        title: args.title ?? 'Eksport',
        defaultPath: args.defaultName,
        filters: args.filters ?? [{ name: 'Text', extensions: ['txt'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false };
      fs.writeFileSync(result.filePath, args.content, 'utf-8');
      return { ok: true, path: result.filePath };
    },
  );

  ipcMain.handle(
    IPC.FILE_OPEN_TEXT,
    async (
      _e,
      args: { title?: string; filters?: { name: string; extensions: string[] }[] },
    ) => {
      const win = getMainWindow();
      const result = await dialog.showOpenDialog(win!, {
        title: args?.title ?? 'Import',
        filters: args?.filters ?? [{ name: 'Text', extensions: ['txt'] }],
        properties: ['openFile'],
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false };
      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      return { ok: true, path: result.filePaths[0], content };
    },
  );

  // ---- LLM ----
  ipcMain.handle(IPC.LLM_IS_AVAILABLE, () => ({
    available: isAiAvailable(),
    model: isAiAvailable() ? getModel() : undefined,
  }));
  ipcMain.handle(
    IPC.LLM_REWRITE_EMAIL,
    async (_e, draftBody: string, language: Lang, ctx?: { supplierName?: string }) =>
      rewriteEmail(draftBody, language, ctx),
  );
  ipcMain.handle(
    IPC.LLM_MATCH_SUGGEST,
    async (_e, sourceName: string, candidates: { id: string; name: string }[]) =>
      suggestMatch(sourceName, candidates),
  );

  // ---- Demo ----
  ipcMain.handle(IPC.DEMO_SEED, () => seedDemo(db));

  // ---- Wipe ----
  ipcMain.handle(IPC.DATA_WIPE, async () => {
    await db.importAll(
      {
        schemaVersion: 1,
        suppliers: [],
        rawMaterials: [],
        components: [],
        products: [],
        stockSnapshots: [],
        productionPlans: [],
        shortageReports: [],
        emailBatches: [],
        orders: [],
        workflowTemplates: [],
        settings: db.getSettings(),
      },
      'replace',
    );
    return { ok: true };
  });

  // ---- App ----
  ipcMain.handle(IPC.APP_GET_VERSION, () => app.getVersion());
  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, (_e, url: string) => shell.openExternal(url));

  ipcMain.handle(IPC.APP_CHECK_UPDATES, async () => {
    if (!app.isPackaged) {
      return { available: false, message: 'Aktualizacje wyłączone w trybie deweloperskim' };
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ available: false, error: 'Timeout' }), 30000);
      const onAvailable = (info: any) => {
        clearTimeout(timeout);
        cleanup();
        resolve({ available: true, info });
      };
      const onNotAvailable = (info: any) => {
        clearTimeout(timeout);
        cleanup();
        resolve({ available: false, message: `Masz najnowszą wersję (${info.version})` });
      };
      const onError = (err: Error) => {
        clearTimeout(timeout);
        cleanup();
        resolve({ available: false, error: err.message });
      };
      const cleanup = () => {
        autoUpdater.removeListener('update-available', onAvailable);
        autoUpdater.removeListener('update-not-available', onNotAvailable);
        autoUpdater.removeListener('error', onError);
      };
      autoUpdater.once('update-available', onAvailable);
      autoUpdater.once('update-not-available', onNotAvailable);
      autoUpdater.once('error', onError);
      autoUpdater.checkForUpdates().catch((err) => {
        clearTimeout(timeout);
        cleanup();
        resolve({ available: false, error: err.message });
      });
    });
  });

  // ---- Auth (Supabase) ----
  ipcMain.handle(IPC.AUTH_SIGN_IN, async (_e, email: string, password: string) =>
    authService.signIn(email, password),
  );
  ipcMain.handle(IPC.AUTH_SIGN_OUT, async () => {
    await authService.signOut();
  });
  ipcMain.handle(IPC.AUTH_GET_SESSION, async () => authService.getSession());

  // ---- One-time local→cloud migration ----
  ipcMain.handle(IPC.MIGRATION_GET_STATUS, () => getMigrationStatus());
  ipcMain.handle(IPC.MIGRATION_RUN, async () => runMigration(db));

  ipcMain.handle(IPC.APP_DOWNLOAD_UPDATE, async () => {
    // Windows: in-app download + install via electron-updater. The
    // `update-downloaded` listener in setupAutoUpdater() calls
    // `quitAndInstall()` once the NSIS installer is on disk.
    if (process.platform === 'win32') {
      try {
        await autoUpdater.downloadUpdate();
        return { ok: true, inApp: true };
      } catch (err) {
        log.warn('Windows in-app update failed, falling back to browser:', err);
        // fall through to the browser-download path below
      }
    }

    // macOS (ad-hoc signed) and Windows fallback: resolve the right
    // installer asset from the latest GitHub release and open it
    // externally — the user's browser takes over and downloads it.
    const releasesPage = 'https://github.com/wikunia-pura/medykamenty/releases/latest';
    const ext =
      process.platform === 'darwin'
        ? '.dmg'
        : process.platform === 'win32'
          ? '.exe'
          : null;
    if (!ext) {
      await shell.openExternal(releasesPage);
      return { ok: true, openedRelease: true };
    }
    try {
      const apiUrl = 'https://api.github.com/repos/wikunia-pura/medykamenty/releases/latest';
      const response = await net.fetch(apiUrl, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        throw new Error(`GitHub API ${response.status}`);
      }
      const release = (await response.json()) as {
        assets?: { name?: string; browser_download_url?: string }[];
      };
      const asset = release.assets?.find(
        (a) => typeof a?.name === 'string' && a.name.toLowerCase().endsWith(ext),
      );
      if (asset?.browser_download_url) {
        await shell.openExternal(asset.browser_download_url);
        return { ok: true };
      }
      throw new Error(`No ${ext} asset found in latest release`);
    } catch (err) {
      log.warn(`Failed to resolve latest ${ext}, falling back to releases page:`, err);
      await shell.openExternal(releasesPage);
      return {
        ok: true,
        openedRelease: true,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  });
}
