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
} from '../../shared/types';
import { parseStockXlsx } from '../services/xlsxStockImporter';
import { importRawMaterialsXlsx } from '../services/xlsxRawMaterialsImporter';
import {
  analyzeRecipesXlsx,
  commitRecipesXlsx,
  exportRecipesXlsx,
} from '../services/recipesXlsxService';
import { matchOne } from '../services/matcher';
import { suggestMatches, normalize as normalizeAlias } from '../services/smartMatcher';
import { computeShortages } from '../services/shortageCalculator';
import { computeCost } from '../services/costCalculator';
import { generateEmailsForReport, regenerateBatchEmail } from '../services/rfqGenerator';
import { maxProducible } from '../services/reverseCalculator';
import { isAiAvailable, getModel } from '../aiConfig';
import { rewriteEmail, suggestMatch } from '../services/llmClient';
import { seedDemo } from '../services/demoSeed';
import * as authService from '../authService';
import { getMigrationStatus, runMigration } from '../migrationService';

export function registerIpcHandlers(db: Database, getMainWindow: () => BrowserWindow | null): void {
  // ---- Suppliers ----
  ipcMain.handle(IPC.SUPPLIERS_LIST, () => db.listSuppliers());
  ipcMain.handle(IPC.SUPPLIERS_GET, (_e, id: string) => db.getSupplier(id));
  ipcMain.handle(IPC.SUPPLIERS_CREATE, (_e, input) => db.createSupplier(input));
  ipcMain.handle(IPC.SUPPLIERS_UPDATE, (_e, id: string, patch) => db.updateSupplier(id, patch));
  ipcMain.handle(IPC.SUPPLIERS_DELETE, (_e, id: string) => db.deleteSupplier(id));

  // ---- Raw materials ----
  ipcMain.handle(IPC.RAW_LIST, () => db.listRawMaterials());
  ipcMain.handle(IPC.RAW_GET, (_e, id: string) => db.getRawMaterial(id));
  ipcMain.handle(IPC.RAW_CREATE, (_e, input) => db.createRawMaterial(input));
  ipcMain.handle(IPC.RAW_UPDATE, (_e, id: string, patch) => db.updateRawMaterial(id, patch));
  ipcMain.handle(IPC.RAW_DELETE, (_e, id: string) => db.deleteRawMaterial(id));

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

  // ---- Components ----
  ipcMain.handle(IPC.COMP_LIST, () => db.listComponents());
  ipcMain.handle(IPC.COMP_GET, (_e, id: string) => db.getComponent(id));
  ipcMain.handle(IPC.COMP_CREATE, (_e, input) => db.createComponent(input));
  ipcMain.handle(IPC.COMP_UPDATE, (_e, id: string, patch) => db.updateComponent(id, patch));
  ipcMain.handle(IPC.COMP_DELETE, (_e, id: string) => db.deleteComponent(id));

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
        const candidates =
          kind === 'raw'
            ? (await db.listRawMaterials()).map((r) => ({ id: r.id, name: r.name, mpFirmaSymbol: r.mpFirmaSymbol }))
            : (await db.listComponents()).map((c) => ({ id: c.id, name: c.name, mpFirmaSymbol: c.mpFirmaSymbol }));

        // Lookup table from user-trained aliases: normalized alias → target id.
        const aliases =
          kind === 'raw' ? await db.listRawMaterialAliases() : await db.listComponentAliases();
        const aliasMap = new Map<string, string>();
        for (const a of aliases) {
          aliasMap.set(normalizeAlias(a.alias), a.targetId);
        }

        for (const row of snapshot.rows) {
          const aliasHit = aliasMap.get(normalizeAlias(row.name));
          if (aliasHit) {
            if (kind === 'raw') row.matchedRawMaterialId = aliasHit;
            else row.matchedComponentId = aliasHit;
            row.matchConfidence = 1;
            row.matchAmbiguous = false;
            matched++;
            if (typeof row.netPrice === 'number' && row.netPrice > 0) {
              if (kind === 'raw') await db.setRawMaterialLastPrice(aliasHit, row.netPrice, row.currency);
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
            // refresh last purchase price (netPrice = Netto S, unit net price)
            if (typeof row.netPrice === 'number' && row.netPrice > 0) {
              if (kind === 'raw') await db.setRawMaterialLastPrice(result.id, row.netPrice, row.currency);
              else await db.setComponentLastPrice(result.id, row.netPrice, row.currency);
            }
          } else if (result.ambiguous) {
            ambiguous++;
          } else {
            unmatched++;
          }
        }
        await db.addStockSnapshot(snapshot);
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
      return { ok: true };
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
  ipcMain.handle(IPC.PLAN_COMPUTE_SHORTAGES, async (_e, planId: string) => {
    const report = await computeShortages(planId, db);
    await db.updatePlan(planId, { status: 'computed', computedAt: report.computedAt });
    await db.addShortageReport(planId, report);
    return report;
  });

  // ---- Shortage report history ----
  ipcMain.handle(IPC.SHORTAGE_REPORT_LIST, () => db.listShortageReports());
  ipcMain.handle(IPC.SHORTAGE_REPORT_GET, (_e, id: string) => db.getShortageReport(id));
  ipcMain.handle(IPC.SHORTAGE_REPORT_DELETE, (_e, id: string) => db.deleteShortageReport(id));
  ipcMain.handle(
    IPC.SHORTAGE_REPORT_UPDATE,
    (_e, id: string, patch: { reportName?: string }) => db.updateShortageReport(id, patch),
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
    IPC.EMAIL_BATCH_UPDATE_EMAIL,
    (_e, batchId: string, emailId: string, patch: { body?: string; subject?: string }) =>
      db.updateBatchEmail(batchId, emailId, patch),
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

  // ---- Reverse ----
  ipcMain.handle(IPC.REVERSE_MAX_PRODUCIBLE, (_e, productId: string) =>
    maxProducible(productId, db),
  );

  // ---- Settings ----
  ipcMain.handle(IPC.SETTINGS_GET, () => db.getSettings());
  ipcMain.handle(IPC.SETTINGS_UPDATE, (_e, patch) => db.updateSettings(patch));

  // ---- Backup ----
  ipcMain.handle(IPC.BACKUP_EXPORT, async () => {
    const win = getMainWindow();
    const result = await dialog.showSaveDialog(win!, {
      title: 'Eksport danych',
      defaultPath: `cutis-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false };
    const data = await db.exportAll();
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { ok: true, path: result.filePath };
  });

  ipcMain.handle(IPC.BACKUP_IMPORT, async (_e, mode: 'merge' | 'replace') => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import danych',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const parsed = JSON.parse(raw) as StoreSchema;
    const out = await db.importAll(parsed, mode);
    return { ok: true, applied: out.applied };
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
    if (process.platform === 'darwin') {
      // Ad-hoc signed builds cannot be auto-installed by electron-updater on macOS.
      // Resolve the latest DMG asset via GitHub API and open it directly so the
      // user's browser starts downloading the installer instead of landing on
      // the release page.
      const releasesPage = 'https://github.com/wikunia-pura/medykamenty/releases/latest';
      try {
        const apiUrl = 'https://api.github.com/repos/wikunia-pura/medykamenty/releases/latest';
        const response = await net.fetch(apiUrl, {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!response.ok) {
          throw new Error(`GitHub API ${response.status}`);
        }
        const release = (await response.json()) as { assets?: { name?: string; browser_download_url?: string }[] };
        const dmgAsset = release.assets?.find(
          (a) => typeof a?.name === 'string' && a.name.toLowerCase().endsWith('.dmg'),
        );
        if (dmgAsset?.browser_download_url) {
          await shell.openExternal(dmgAsset.browser_download_url);
          return { ok: true };
        }
        throw new Error('No DMG asset found in latest release');
      } catch (err) {
        log.warn('Failed to resolve latest DMG, falling back to releases page:', err);
        await shell.openExternal(releasesPage);
        return {
          ok: true,
          openedRelease: true,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    }
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  });
}
