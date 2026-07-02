// Import the warehouse spreadsheet ("Magazyn.xlsx"), second tab "Stan
// surowców", into the raw-materials catalog. Like the component stock import it
// NEVER creates catalog entries — it only matches rows to materials that
// already exist, by name (column A).
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
import log from '../utils/logger';

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length === 0 ? undefined : t;
  }
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return undefined; // dates handled by asDate
  if (typeof v === 'object') {
    if ('text' in v) return asString((v as { text: unknown }).text);
    if ('richText' in v) {
      const parts = (v as { richText?: { text?: string }[] }).richText ?? [];
      const joined = parts.map((p) => p?.text ?? '').join('').trim();
      return joined.length === 0 ? undefined : joined;
    }
    if ('result' in v) return asString((v as { result: unknown }).result);
    if ('hyperlink' in v) return asString((v as { hyperlink: unknown }).hyperlink);
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const cleaned = v.replace(/\s/g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === 'object' && v !== null && 'result' in v) {
    return asNumber((v as { result: unknown }).result);
  }
  return undefined;
}

// Excel date cells come back as JS Date (exceljs), sometimes as a formula
// result, occasionally as an ISO/locale string. Normalize to YYYY-MM-DD, or
// undefined when the cell isn't a real date.
function asDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return undefined;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    if ('result' in v) return asDate((v as { result: unknown }).result);
    if ('text' in v) return asDate((v as { text: unknown }).text);
  }
  if (typeof v === 'string') {
    const d = new Date(v.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return undefined;
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

    const batch: RawStockBatchRow = {
      qty: asNumber(r.getCell(layout.qtyCol).value) ?? 0,
      productionDate: asDate(r.getCell(layout.prodCol).value),
      expiryDate: asDate(r.getCell(layout.expiryCol).value),
      microTestDate: asDate(r.getCell(layout.microCol).value),
      retestExpiryDate: asDate(r.getCell(layout.retestCol).value),
      note: asString(r.getCell(layout.noteCol).value),
    };
    const reportedTotal = asNumber(r.getCell(layout.totalCol).value);

    const result = matchOne({ name }, candidates);
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
      `${ambiguousNames.size} ambiguous`,
  );

  return {
    sourceFile: `${path.basename(filePath)} – ${ws.name}`,
    matches,
    unmatched,
    ambiguousNames: Array.from(ambiguousNames),
  };
}
