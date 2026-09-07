// Import the warehouse spreadsheet ("Magazyn.xlsx") into the component /
// bulk-packaging catalog. The file carries the two catalogs in separate tabs
// ("Stan komponentów" for primary components, "Opakowania zbiorcze" for
// secondary/bulk packaging) so each analysis run is scoped to one
// ComponentSection: it reads only that section's sheet and matches only
// against catalog components of that section (see isSecondaryComponent) — a
// run never sees rows or catalog entries from the other section. Rows with no
// match are returned as `unmatched` create-candidates — the user decides per
// row whether to create them (type inferred from the name, see
// inferComponentType) or skip them; nothing is created without that decision.
// Names matching >1 catalog entry are reported in `ambiguousNames` and
// skipped, since there is no way to tell which entry the stock belongs to.
//
// The sheet layout (row 1 is the header):
//   A  Nazwa                    → matched to a catalog component by name
//   B  Stan system <date>       → ignored
//   C  Stan magazyn <date>      → the physical warehouse count we import
//   D  Stan system <date>       → ignored
//   E  Uwagi                    → free-text note shown next to the stock
// The date labels change month to month, so column C is read positionally
// (name column + 2) and the note column is found by its "Uwagi" header with an
// E-column fallback — matching what the user described ("kolumna C", "kolumna E").
//
// Two-phase, like the recipe importer: analyzeMagazynStock() parses + matches
// with no writes; the renderer resolves per-item quantity differences and the
// create/skip choice for unmatched rows; then the IPC layer applies the
// decisions.

import ExcelJS from 'exceljs';
import path from 'path';
import type Database from '../database';
import type {
  ComponentSection,
  MagazynStockAnalysis,
  MagazynStockMatch,
  MagazynStockUnmatched,
  PackagingComponent,
} from '../../shared/types';
import { isSecondaryComponent } from '../../shared/types';
import { matchOne } from './matcher';
import log from '../utils/logger';

function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length === 0 ? undefined : t;
  }
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object' && v !== null) {
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

// Pick the sheet for the given catalog section. 'primary' looks for the first
// non-archival worksheet whose name mentions "komponent" ("Stan komponentów"),
// falling back to the first sheet for older files that don't name it that way.
// 'secondary' looks for "Opakowania zbiorcze" (matched loosely on "zbiorcz")
// with no fallback — that tab is new (see Magazyn-5.xlsx) and older files
// don't have it, so silently reading the wrong sheet would be worse than
// failing with a clear message.
function findSheet(wb: ExcelJS.Workbook, section: ComponentSection): ExcelJS.Worksheet | undefined {
  if (section === 'secondary') {
    return wb.worksheets.find((ws) => {
      const n = ws.name.toLowerCase();
      return n.includes('zbiorcz') && !n.includes('archiw');
    });
  }
  const named = wb.worksheets.find((ws) => {
    const n = ws.name.toLowerCase();
    return n.includes('komponent') && !n.includes('archiw');
  });
  return named ?? wb.worksheets[0];
}

// Locate the header row and the name/notes columns. The name column is the cell
// labelled "Nazwa"; the note column is "Uwagi" (fallback: name column + 4 = E).
function findLayout(
  ws: ExcelJS.Worksheet,
): { headerRow: number; nameCol: number; qtyCol: number; noteCol: number } | null {
  const limit = Math.min(20, ws.rowCount);
  for (let i = 1; i <= limit; i++) {
    const row = ws.getRow(i);
    let nameCol: number | undefined;
    let noteCol: number | undefined;
    row.eachCell((cell, col) => {
      const lower = (asString(cell.value) ?? '').toLowerCase();
      if (lower === 'nazwa' || lower === 'name') nameCol = col;
      else if (lower === 'uwagi' || lower === 'notes') noteCol = col;
    });
    if (nameCol !== undefined) {
      return {
        headerRow: i,
        nameCol,
        // Column C relative to the name column (user's "kolumna C").
        qtyCol: nameCol + 2,
        noteCol: noteCol ?? nameCol + 4,
      };
    }
  }
  return null;
}

const QTY_EPS = 1e-6;

export async function analyzeMagazynStock(
  filePath: string,
  db: Database,
  section: ComponentSection = 'primary',
): Promise<MagazynStockAnalysis> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = findSheet(wb, section);
  if (!ws) {
    const sheetLabel = section === 'secondary' ? 'Opakowania zbiorcze' : 'Stan komponentów';
    throw new Error(`Brak arkusza „${sheetLabel}” w pliku ${path.basename(filePath)}.`);
  }

  const layout = findLayout(ws);
  if (!layout) {
    throw new Error(`Nie rozpoznano nagłówków arkusza "${ws.name}" (wymagana kolumna "Nazwa").`);
  }

  // Scope matching to this section's catalog subset — a row from the
  // "komponenty" sheet should never match a bulk-packaging entry and vice
  // versa, even if two names were ever to collide.
  const components = (await db.listComponents()).filter((c) =>
    section === 'secondary' ? isSecondaryComponent(c.type) : !isSecondaryComponent(c.type),
  );
  const candidates = components.map((c) => ({
    id: c.id,
    name: c.name,
    mpFirmaSymbol: c.mpFirmaSymbol,
  }));
  const byId = new Map<string, PackagingComponent>(components.map((c) => [c.id, c]));

  // A catalog component can appear only once in the file, but guard anyway: if
  // two rows match the same component, sum their quantities and merge notes.
  const matchesById = new Map<string, MagazynStockMatch>();
  const unmatchedByName = new Map<string, MagazynStockUnmatched>();
  const ambiguousNames: string[] = [];

  for (let i = layout.headerRow + 1; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const name = asString(r.getCell(layout.nameCol).value);
    if (!name) continue;

    const importedQty = asNumber(r.getCell(layout.qtyCol).value) ?? 0;
    const note = asString(r.getCell(layout.noteCol).value);

    const result = matchOne({ name }, candidates);
    const item = result.id && !result.ambiguous ? byId.get(result.id) : undefined;
    if (!item) {
      if (result.ambiguous) {
        // Matched >1 catalog entry — can't decide automatically, keep as a
        // warning rather than offering to create a duplicate.
        ambiguousNames.push(name);
      } else {
        // No match — offer to create. Merge repeat rows of the same name.
        const key = name.trim().toLowerCase();
        const cur = unmatchedByName.get(key);
        if (cur) {
          cur.qty += importedQty;
          cur.note = [cur.note, note].filter(Boolean).join('\n') || undefined;
        } else {
          unmatchedByName.set(key, { name: name.trim(), qty: importedQty, note });
        }
      }
      continue;
    }

    const existing = matchesById.get(item.id);
    if (existing) {
      existing.importedQty += importedQty;
      existing.note = [existing.note, note].filter(Boolean).join('\n') || undefined;
      existing.differs = Math.abs(existing.importedQty - (existing.currentQty ?? 0)) > QTY_EPS;
      continue;
    }
    matchesById.set(item.id, {
      itemId: item.id,
      name: item.name,
      excelName: name,
      currentQty: item.stockQty,
      importedQty,
      note,
      differs: Math.abs(importedQty - (item.stockQty ?? 0)) > QTY_EPS,
    });
  }

  const matches = Array.from(matchesById.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'pl'),
  );
  const unmatched = Array.from(unmatchedByName.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'pl'),
  );

  log.info(
    `[magazyn-stock] ${path.basename(filePath)} → ${matches.length} matched, ` +
      `${matches.filter((m) => m.differs).length} differ, ${unmatched.length} unmatched, ` +
      `${ambiguousNames.length} ambiguous`,
  );

  return {
    sourceFile: `${path.basename(filePath)} – ${ws.name}`,
    matches,
    unmatched,
    ambiguousNames,
  };
}
