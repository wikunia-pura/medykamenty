// Import the warehouse spreadsheet ("Magazyn.xlsx"), second tab "Stan
// surowców", into the raw-materials catalog. Rows are matched to existing
// materials by name (column A). Like the component stock import, rows with no
// match come back as `unmatched` create-candidates the user creates or skips
// per row (unit defaults to kg); names matching >1 material land in
// `ambiguousNames` and are skipped.
//
// The twist: a material's stock can be split across several rows, one per
// batch/lot, because each lot has its own expiry. So rows are grouped by the
// matched material and each becomes a StockBatch. The sheet layout:
//   A  Nazwa                                   → matched to a catalog material
//   B  Stan system <date>                      → ignored
//   C  Stan magazyn <date>                     → batch quantity
//   D  Stan system <date>                      → the material total (validation)
//   E  Data produkcji                          → batch production date
//   F  Data ważności                           → batch expiry (original)
//   G  Badania mikrobiologiczne                → batch micro-test date
//   H  Data ważności po reteście (fiz.-chem.)  → effective expiry when present
//   I  Uwagi                                   → per-batch note
// Column C is read positionally (name column + 2); the date/note columns are
// found by their headers with positional fallbacks.
//
// When the batch quantities (Σ column C) don't match the material total
// (column D), the row is flagged as a "sum mismatch" for the user to resolve
// (take from import / reject). Two-phase like the recipe importer.

import ExcelJS from 'exceljs';
import path from 'path';
import type Database from '../database';
import type {
  RawStockAnalysis,
  RawStockBatchRow,
  RawStockMatch,
  RawStockUnmatched,
  RawMaterial,
} from '../../shared/types';
import { matchOne } from './matcher';
import { normalize as normalizeAlias } from './smartMatcher';
import { asNumber, asString, excelDateIso } from './xlsxCells';
import log from '../utils/logger';

// Excel date cells come back as JS Date (exceljs, UTC midnight of the sheet's
// wall-clock day), sometimes as a formula result, occasionally as text typed
// by hand ("05.03.2025"). Normalize to YYYY-MM-DD. `ok: false` means the cell
// is non-empty but not a date — the caller reports it instead of dropping it
// silently.
function asDate(v: unknown): { ok: true; value?: string } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true };
  if (v instanceof Date) {
    const iso = excelDateIso(v);
    return iso ? { ok: true, value: iso } : { ok: false };
  }
  if (typeof v === 'number') {
    // A date serial in a cell without a date format (1900 date system).
    // 20000..80000 ≈ 1954..2119 — anything else isn't a plausible date.
    if (!Number.isFinite(v) || v < 20000 || v > 80000) return { ok: false };
    return { ok: true, value: excelDateIso(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)) };
  }
  if (typeof v === 'object') {
    if ('error' in v) return { ok: false };
    if ('result' in v) return asDate((v as { result: unknown }).result);
  }
  const text = asString(v);
  if (text === undefined) return { ok: true };
  return parseDateText(text);
}

// "DD.MM.YYYY" (also "/" or "-" as separator, 2-digit year → 20YY) — the
// Polish order, always; and ISO "YYYY-MM-DD". `new Date("05.03.2025")` used to
// read it as US month-first (and drop any day > 12), then toISOString shifted
// it a day back in Polish time.
function parseDateText(text: string): { ok: true; value: string } | { ok: false } {
  let y: number;
  let m: number;
  let d: number;
  const pl = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})(?:\s.*)?$/.exec(text);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (iso) {
    y = Number(iso[1]);
    m = Number(iso[2]);
    d = Number(iso[3]);
  } else if (pl) {
    d = Number(pl[1]);
    m = Number(pl[2]);
    y = Number(pl[3]);
    if (pl[3].length === 2) y += 2000;
  } else {
    return { ok: false };
  }
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return { ok: false }; // 31.02.2025 and the like
  }
  return { ok: true, value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

function columnLetter(col: number): string {
  let out = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  }
  return out;
}

function findSurowceSheet(wb: ExcelJS.Workbook): ExcelJS.Worksheet | undefined {
  return wb.worksheets.find((ws) => {
    const n = ws.name.toLowerCase();
    return n.includes('surow') && !n.includes('archiw');
  });
}

interface Layout {
  headerRow: number;
  nameCol: number;
  qtyCol: number; // C
  totalCol: number; // D
  prodCol: number; // E
  expiryCol: number; // F
  microCol: number; // G
  retestCol: number; // H
  noteCol: number; // I
}

// Find the header row (the one with a "Nazwa" cell) and resolve columns.
// Dated headers ("Stan magazyn 06.2026") are read positionally off the name
// column; the text-labelled columns are matched by header where possible.
function findLayout(ws: ExcelJS.Worksheet): Layout | null {
  const limit = Math.min(20, ws.rowCount);
  for (let i = 1; i <= limit; i++) {
    const row = ws.getRow(i);
    let nameCol: number | undefined;
    const byLabel: Record<string, number> = {};
    row.eachCell((cell, col) => {
      const lower = (asString(cell.value) ?? '').toLowerCase();
      if (lower === 'nazwa' || lower === 'name') nameCol = col;
      else if (lower.startsWith('data produkcji')) byLabel.prod = col;
      else if (lower.startsWith('data ważności po reteście') || lower.startsWith('data waznosci po retescie'))
        byLabel.retest = col;
      else if (lower.startsWith('data ważności') || lower.startsWith('data waznosci'))
        byLabel.expiry = col;
      else if (lower.startsWith('badania')) byLabel.micro = col;
      else if (lower === 'uwagi' || lower === 'notes') byLabel.note = col;
    });
    if (nameCol !== undefined) {
      return {
        headerRow: i,
        nameCol,
        qtyCol: nameCol + 2, // C
        totalCol: nameCol + 3, // D
        prodCol: byLabel.prod ?? nameCol + 4, // E
        expiryCol: byLabel.expiry ?? nameCol + 5, // F
        microCol: byLabel.micro ?? nameCol + 6, // G
        retestCol: byLabel.retest ?? nameCol + 7, // H
        noteCol: byLabel.note ?? nameCol + 8, // I
      };
    }
  }
  return null;
}

const SUM_EPS = 0.05; // tolerate small rounding differences between Σ(C) and D

export async function analyzeRawStock(filePath: string, db: Database): Promise<RawStockAnalysis> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = findSurowceSheet(wb);
  if (!ws) throw new Error(`Nie znaleziono arkusza "Stan surowców" w pliku ${path.basename(filePath)}.`);

  const layout = findLayout(ws);
  if (!layout) {
    throw new Error('Nie rozpoznano nagłówków arkusza "Stan surowców" (wymagana kolumna "Nazwa").');
  }

  const materials = await db.listRawMaterials();
  const candidates = materials.map((m) => ({ id: m.id, name: m.name, mpFirmaSymbol: m.mpFirmaSymbol }));
  const byId = new Map<string, RawMaterial>(materials.map((m) => [m.id, m]));
  // Saved aliases (an explicit user decision) win over fuzzy matching, like
  // every other import path.
  const aliasMap = new Map<string, string>();
  for (const a of await db.listRawMaterialAliases()) {
    aliasMap.set(normalizeAlias(a.alias), a.targetId);
  }
  const warnings: string[] = [];

  interface Agg {
    item?: RawMaterial; // undefined for unmatched (create-candidate) materials
    name: string; // catalog name when matched, else the file name
    excelName: string;
    batches: RawStockBatchRow[];
    reportedTotal?: number;
  }
  const aggById = new Map<string, Agg>();
  // Unmatched materials, keyed by normalized name so repeat rows group into one.
  const aggUnmatched = new Map<string, Agg>();
  const ambiguousNames = new Set<string>();

  for (let i = layout.headerRow + 1; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const name = asString(r.getCell(layout.nameCol).value);
    if (!name) continue;

    // A date cell that holds something other than a date ("?", a remark) is
    // imported as "no date" — but reported, never dropped silently.
    const dateAt = (col: number, label: string): string | undefined => {
      const cell = r.getCell(col).value;
      const res = asDate(cell);
      if (res.ok) return res.value;
      warnings.push(
        `Wiersz ${i}, kolumna ${columnLetter(col)} (${label}) dla „${name}": „${asString(cell) ?? '?'}" nie jest datą — pominięto tę datę.`,
      );
      return undefined;
    };
    const batch: RawStockBatchRow = {
      qty: asNumber(r.getCell(layout.qtyCol).value) ?? 0,
      productionDate: dateAt(layout.prodCol, 'data produkcji'),
      expiryDate: dateAt(layout.expiryCol, 'data ważności'),
      microTestDate: dateAt(layout.microCol, 'badania mikrobiologiczne'),
      retestExpiryDate: dateAt(layout.retestCol, 'data ważności po reteście'),
      note: asString(r.getCell(layout.noteCol).value),
    };
    const reportedTotal = asNumber(r.getCell(layout.totalCol).value);

    const aliasTarget = aliasMap.get(normalizeAlias(name));
    const aliasItem = aliasTarget ? byId.get(aliasTarget) : undefined;
    const result = aliasItem
      ? { id: aliasItem.id, confidence: 1, ambiguous: false }
      : matchOne({ name }, candidates);
    const item = result.id && !result.ambiguous ? byId.get(result.id) : undefined;
    if (!item) {
      if (result.ambiguous) {
        // Matched >1 catalog entry — leave as a warning rather than create.
        ambiguousNames.add(name);
        continue;
      }
      // No match — group its rows into a create-candidate.
      const key = name.trim().toLowerCase();
      const agg = aggUnmatched.get(key);
      if (agg) {
        agg.batches.push(batch);
        if (agg.reportedTotal === undefined && reportedTotal !== undefined) {
          agg.reportedTotal = reportedTotal;
        }
      } else {
        aggUnmatched.set(key, { name: name.trim(), excelName: name, batches: [batch], reportedTotal });
      }
      continue;
    }

    const agg = aggById.get(item.id);
    if (agg) {
      agg.batches.push(batch);
      // The total (column D) repeats on every row of a material; keep the first
      // non-empty one.
      if (agg.reportedTotal === undefined && reportedTotal !== undefined) {
        agg.reportedTotal = reportedTotal;
      }
    } else {
      aggById.set(item.id, { item, name: item.name, excelName: name, batches: [batch], reportedTotal });
    }
  }

  const matches: RawStockMatch[] = Array.from(aggById.values())
    .map((agg) => {
      const batchSum = agg.batches.reduce((s, b) => s + b.qty, 0);
      const sumMismatch =
        agg.reportedTotal !== undefined && Math.abs(batchSum - agg.reportedTotal) > SUM_EPS;
      // Stock typed in by hand must not be overwritten without a decision.
      const manualConflict =
        agg.item!.stockSource === 'manual' &&
        Math.abs(batchSum - (agg.item!.stockQty ?? 0)) > SUM_EPS;
      return {
        itemId: agg.item!.id,
        name: agg.item!.name,
        excelName: agg.excelName,
        unit: agg.item!.unit,
        currentQty: agg.item!.stockQty,
        batches: agg.batches,
        batchSum,
        reportedTotal: agg.reportedTotal,
        sumMismatch,
        manualConflict,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  const unmatched: RawStockUnmatched[] = Array.from(aggUnmatched.values())
    .map((agg) => ({
      name: agg.name,
      unit: 'kg' as const, // the sheet carries no unit; kg is the house default
      batches: agg.batches,
      batchSum: agg.batches.reduce((s, b) => s + b.qty, 0),
      reportedTotal: agg.reportedTotal,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  log.info(
    `[magazyn-raw] ${path.basename(filePath)} → ${matches.length} matched materials, ` +
      `${matches.filter((m) => m.sumMismatch).length} sum-mismatch, ${unmatched.length} unmatched, ` +
      `${ambiguousNames.size} ambiguous, ` +
      `${matches.filter((m) => m.manualConflict).length} manual-conflict, ${warnings.length} warnings`,
  );

  return {
    sourceFile: `${path.basename(filePath)} – ${ws.name}`,
    matches,
    unmatched,
    ambiguousNames: Array.from(ambiguousNames),
    warnings,
  };
}
