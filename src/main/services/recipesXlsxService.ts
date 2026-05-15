// Import and export of the "Plik z recepturami.xlsx" file — the formulation
// chemist's source of truth. Each product is a block:
//
//   Row N+0:  Nazwa produktu | Pojemność [ml] | … | MOQ [szt.] | Masa na saszetki [kg]
//   Row N+1:  <product name>  | <ml>           |   | <MOQ>      | <kg>
//   Row N+2:  Surowce | Zawartość % | Przelicznik + 5% [g] | Ilość w g | Cena/kg | Cena/g | Wartość | Dostępność | … | …
//   Row N+3:  Woda  | do 100%  (special — ignored, the rest of the recipe fills below 100%)
//   Row N+4…: <surowiec> | <% udział> | <przelicznik> | <ilość g> | <cena/kg> | <cena/g> | <wartość> | MY|RETTER
//   Row …  :  Komponenty                          (primary packaging — bottle/jar/label/leaflet/box)
//   Row …  :  Pozostałe komponenty               (secondary — outer carton, tape, barrel, bag)
//   Row …  :  Konfekcja                           (lone marker for labour/assembly)
//   Row …  :  blank or  …  …  …  …  …  Suma | <unit cost>
//
// Conventions worth knowing:
//   * Przelicznik [g] = pojemność_ml * gęstość_g_ml * RECIPE_WASTE_MARGIN
//     so density = Przelicznik / (capacityMl * 1.05). The "+5%" is baked into
//     the spreadsheet format itself, hence the hard-coded constant below.
//   * "Dostępność" column: MY = we buy the raw material; RETTER = factory keeps
//     it on site and invoices us post-production → maps to factorySupplied=true.

import ExcelJS from 'exceljs';
import path from 'path';
import Database from '../database';
import type {
  ComponentType,
  PackagingComponent,
  PackingCapacityUnit,
  PackingTier,
  Product,
  RawMaterial,
  RecipeImportAnalysis,
  RecipeImportMode,
  RecipeImportProductResult,
  RecipeImportResolutionEntry,
  RecipeImportResolutions,
  RecipeImportSummary,
  RecipeImportUnresolvedItem,
} from '../../shared/types';
import { isSecondaryComponent } from '../../shared/types';
import log from '../utils/logger';
import { normalize as smartNormalize, suggestMatches } from './smartMatcher';

// Index of the catalog passed around when resolving ingredients/components.
// Bundles the trivially-normalized lookup, smart-normalized fallback, alias
// table (from stock import), and id-keyed map so callers can do all the
// lookup variants in one place. Mutated as new entries are created so later
// rows in the same import see them.
interface CatalogIndex<T extends { id: string; name: string }> {
  byKey: Map<string, T>;
  smartByKey: Map<string, T[]>;
  byId: Map<string, T>;
  aliasMap: Map<string, string>;
}

function buildIndex<T extends { id: string; name: string }>(
  items: T[],
  aliases: { alias: string; targetId: string }[],
): CatalogIndex<T> {
  const byKey = new Map<string, T>();
  const smartByKey = new Map<string, T[]>();
  const byId = new Map<string, T>();
  for (const it of items) {
    byKey.set(normalize(it.name), it);
    byId.set(it.id, it);
    const k = smartNormalize(it.name);
    if (k) {
      const arr = smartByKey.get(k) ?? [];
      arr.push(it);
      smartByKey.set(k, arr);
    }
  }
  const aliasMap = new Map<string, string>();
  for (const a of aliases) aliasMap.set(smartNormalize(a.alias), a.targetId);
  return { byKey, smartByKey, byId, aliasMap };
}

function indexAdd<T extends { id: string; name: string }>(
  idx: CatalogIndex<T>,
  item: T,
): void {
  idx.byKey.set(normalize(item.name), item);
  idx.byId.set(item.id, item);
  const k = smartNormalize(item.name);
  if (k) {
    const arr = (idx.smartByKey.get(k) ?? []).filter((x) => x.id !== item.id);
    arr.push(item);
    idx.smartByKey.set(k, arr);
  }
}

// Strict-ish equality between a product patch and the existing product. Uses
// JSON for the array fields (ingredients/packaging) because their entries are
// plain `{id, percentage}` / `{id, qtyPerUnit}` and the importer writes them
// in a stable order — so structural equality is enough to suppress no-op
// writes.
function productPatchHasChanges(existing: Product, patch: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(patch)) {
    const ex = (existing as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value) || Array.isArray(ex)) {
      if (JSON.stringify(ex ?? []) !== JSON.stringify(value ?? [])) return true;
      continue;
    }
    if (ex !== value) return true;
  }
  return false;
}

// Lookup order: exact name → saved alias → null. Mirrors the stock importer's
// "definitely the same item" branches; everything fuzzy (smart-normalize
// matches like "Allantoina" ↔ "Allantoina (BASF)" or any Levenshtein-close
// pair) is left for the user to resolve in the modal, identically to stock
// import.
function lookupExisting<T extends { id: string; name: string }>(
  idx: CatalogIndex<T>,
  name: string,
  // Kept for call-site compatibility; nothing is auto-resolved here so we
  // never push a warning anymore.
  _warnings: string[],
): T | undefined {
  const existing = idx.byKey.get(normalize(name));
  if (existing) return existing;
  const aliasTargetId = idx.aliasMap.get(smartNormalize(name));
  if (aliasTargetId) {
    const hit = idx.byId.get(aliasTargetId);
    if (hit) return hit;
  }
  return undefined;
}

// The Excel format literally says "Przelicznik + 5% [g]" — the 5% headroom is a
// hard convention of this file, independent of the user's settings.wasteFactor
// (which affects cost calculation, not the source-of-truth file layout).
const RECIPE_WASTE_MARGIN = 1.05;

// ---------- normalization helpers ----------

// Strip invisible characters that can sneak in via copy-paste from Excel/web
// (zero-width space U+200B, ZWNJ U+200C, ZWJ U+200D, word joiner U+2060,
// BOM U+FEFF, soft hyphen U+00AD) before the usual trim/lowercase/whitespace-
// collapse. Otherwise two names that look identical can have different bytes
// and fail exact match. NBSP is already handled by `\s+` later in the chain.
const INVISIBLE_CHARS = /[​-‍⁠﻿­]/gu;

function normalize(s: string): string {
  return s
    .replace(INVISIBLE_CHARS, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

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
  }
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
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

// ---------- section/row classification ----------

type RowClass =
  | { kind: 'product_header' } // "Nazwa produktu" row
  | { kind: 'product_values'; name: string; capacityMl?: number; moqUnits?: number; sachetMassKg?: number }
  | { kind: 'ingredients_header' } // "Surowce" row
  | { kind: 'components_marker' } // "Komponenty" row
  | { kind: 'others_marker' } // "Pozostałe komponenty" row
  | { kind: 'water'; nameRaw: string } // "Woda" / "Woda demineralizowana"
  | {
      kind: 'ingredient';
      name: string;
      percentage: number;
      pricePerKg?: number;
      channel?: 'MY' | 'RETTER';
    }
  | { kind: 'packaging'; name: string; capacityHint?: number; capacityUnitHint?: PackingCapacityUnit }
  // "Konfekcja" — assembly/labour cost line. NOT a raw material and NOT a
  // packaging component. The numeric value lands on `Product.conversionLaborCost`.
  | { kind: 'konfekcja'; cost?: number }
  | { kind: 'sum' } // totals row, last line of a block
  | { kind: 'blank' }
  | { kind: 'unknown' };

function classifyRow(cells: unknown[]): RowClass {
  const c0 = asString(cells[0]);
  const c1 = asString(cells[1]);
  const c5 = asString(cells[5]); // "Suma" lives in column F

  // Sum line: column F == "Suma" with a numeric value in G.
  if (c5 && normalize(c5) === 'suma') return { kind: 'sum' };

  if (!c0 && !c1) return { kind: 'blank' };

  if (c0) {
    const n0 = normalize(c0);

    if (n0 === 'nazwa produktu') return { kind: 'product_header' };
    if (n0 === 'surowce') return { kind: 'ingredients_header' };
    if (n0 === 'komponenty') return { kind: 'components_marker' };
    if (n0 === 'pozostałe komponenty' || n0 === 'pozostale komponenty') {
      return { kind: 'others_marker' };
    }

    // Konfekcja: labour/assembly cost line, NOT a recipe item. Catch it here
    // (before the generic ingredient check below) so a number in column B
    // doesn't make us think it's a 100%-share raw material. Cost may live
    // in column G ("Wartość") canonically, or any other numeric cell — we
    // take G first, then fall back to the first positive number in B…F.
    if (n0 === 'konfekcja') {
      let cost = asNumber(cells[6]);
      if (cost === undefined) {
        for (let i = 1; i <= 5; i++) {
          const v = asNumber(cells[i]);
          if (v !== undefined && v > 0) {
            cost = v;
            break;
          }
        }
      }
      return { kind: 'konfekcja', cost };
    }

    // Water row: name starts with "woda" and column B is "do 100%" (string).
    if (n0.startsWith('woda')) {
      const c1norm = c1 ? normalize(c1) : '';
      if (c1norm === 'do 100%' || c1norm.startsWith('do 100')) {
        return { kind: 'water', nameRaw: c0 };
      }
      // A literal "Woda" row with a numeric % is unusual but we still treat it
      // as an ingredient — the user explicitly wrote a percentage.
    }
  }

  // Product values row: numeric capacity in column B (and column A holds the
  // product name). We rely on the parser's state machine, not row content
  // alone, to disambiguate from "ingredient with numeric %" rows.
  // Caller decides whether this is a "values" row based on the previous row's
  // classification.

  // Ingredient row: name in A, numeric or "do 100%" in B.
  const pct = asNumber(cells[1]);
  if (c0 && pct !== undefined && Number.isFinite(pct)) {
    const channelRaw = asString(cells[7]);
    let channel: 'MY' | 'RETTER' | undefined;
    if (channelRaw) {
      const n = normalize(channelRaw);
      if (n === 'my') channel = 'MY';
      else if (n === 'retter') channel = 'RETTER';
    }
    const pricePerKg = asNumber(cells[4]);
    return {
      kind: 'ingredient',
      name: c0,
      percentage: pct,
      pricePerKg,
      channel,
    };
  }

  // Packaging row: name in A. Column B may optionally carry a capacity hint
  // (e.g. "50" for "50 products per carton") and column C an optional unit
  // override ("kg" or "l" — for barrels of bulk); columns D…J should be empty.
  if (c0 && cells.slice(3).every((v) => asString(v) === undefined && asNumber(v) === undefined)) {
    const capHint = asNumber(cells[1]);
    const b = asString(cells[1]);
    // Don't accept B as a capacity if it's clearly a header word like
    // "Zawartość %" — only pure numbers count.
    if (b && capHint === undefined) return { kind: 'unknown' };
    const unitRaw = asString(cells[2]);
    let unitHint: PackingCapacityUnit | undefined;
    if (unitRaw) {
      const n = normalize(unitRaw);
      if (n === 'units' || n === 'szt' || n === 'szt.' || n === 'pcs') unitHint = 'units';
      else if (n === 'kg') unitHint = 'kg';
      else if (n === 'l' || n === 'l.') unitHint = 'l';
      else return { kind: 'unknown' };
    }
    return { kind: 'packaging', name: c0, capacityHint: capHint, capacityUnitHint: unitHint };
  }

  return { kind: 'unknown' };
}

// ---------- component type inference ----------

function inferComponentType(rawName: string, sectionHint: 'primary' | 'secondary'): ComponentType {
  const n = normalize(rawName);

  // Always-secondary patterns (override section hint).
  if (n === 'konfekcja') return 'confection';
  if (n.startsWith('karton zbiorczy')) return 'outer_carton';
  if (n.startsWith('taśma') || n.startsWith('tasma')) return 'tape';
  if (n.startsWith('beczka')) return 'barrel';
  if (n.startsWith('worek')) return 'bag';

  // Primary patterns.
  if (n.startsWith('tuba')) return 'tube';
  if (n.startsWith('butelka')) return 'bottle';
  if (n.startsWith('słoik') || n.startsWith('sloik')) return 'jar';
  if (n.startsWith('etykieta')) return 'label';
  if (n.startsWith('kartonik')) return 'box';
  if (n.startsWith('ulotka')) return 'leaflet';
  if (n.startsWith('dozownik') || n.startsWith('atomizer')) return 'pump';
  if (n.startsWith('nakrętka') || n.startsWith('nakretka') || n.startsWith('zamknięcie') || n.startsWith('zamkniecie')) {
    return 'cap';
  }
  if (n.startsWith('pipeta') || n.startsWith('pipetka')) return 'pipette';

  return sectionHint === 'secondary' ? 'other' : 'other';
}

// ---------- block extraction ----------

export interface RawIngredient {
  name: string;
  percentage: number;
  pricePerKg?: number;
  channel?: 'MY' | 'RETTER';
}

export interface RawPackaging {
  name: string;
  section: 'primary' | 'secondary';
  // For secondary section only: optional "this container holds N <unit>"
  // capacity hint from column B. Without a hint, commit() defaults to
  // capacity=1 and flags the tier for review.
  capacityHint?: number;
  capacityUnitHint?: PackingCapacityUnit;
}

export interface RecipeBlock {
  name: string;
  capacityMl?: number;
  moqUnits?: number;
  sachetMassKg?: number;
  // Pre-5% mass (g) of one production batch, taken from "Przelicznik + 5% [g]".
  // Same value should appear on every ingredient row of the block; we keep the
  // first non-empty one so we can recover density downstream.
  przelicznikG?: number;
  // Value from the "Konfekcja" line (labour/assembly cost per product unit).
  // Lands on `Product.conversionLaborCost` during commit.
  conversionLaborCost?: number;
  ingredients: RawIngredient[];
  packaging: RawPackaging[];
  warnings: string[];
}

function extractBlocks(ws: ExcelJS.Worksheet): RecipeBlock[] {
  const blocks: RecipeBlock[] = [];
  let current: RecipeBlock | null = null;
  // Parser state — tells us what we expect from the next non-blank row.
  type State =
    | 'idle'
    | 'expect_product_values'
    | 'expect_ingredients_header'
    | 'reading_ingredients'
    | 'reading_primary_components'
    | 'reading_secondary_components';
  let state: State = 'idle';

  const finishBlock = () => {
    if (current) {
      blocks.push(current);
      current = null;
    }
    state = 'idle';
  };

  for (let i = 1; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    const cells: unknown[] = [];
    for (let c = 1; c <= 10; c++) cells.push(row.getCell(c).value);
    const cls = classifyRow(cells);

    if (cls.kind === 'sum') {
      // End of block — a "Suma" line.
      finishBlock();
      continue;
    }

    if (cls.kind === 'blank') {
      // Blank line: if we were reading components, that's the end of block.
      if (state !== 'idle') finishBlock();
      continue;
    }

    if (cls.kind === 'product_header') {
      finishBlock();
      state = 'expect_product_values';
      continue;
    }

    // In the source file the "Nazwa produktu" header strip appears only ONCE
    // (above the first block). Every subsequent product starts straight with
    // its values row. Heuristic: when idle and a row has both a non-empty
    // name in col A and a numeric MOQ in col I (the dedicated MOQ column),
    // treat it as the start of a new product block.
    if (state === 'idle' && current === null) {
      const a = asString(cells[0]);
      const moq = asNumber(cells[8]);
      const cap = asNumber(cells[1]);
      if (a && moq !== undefined && cap !== undefined) {
        current = {
          name: a,
          capacityMl: cap,
          moqUnits: moq,
          sachetMassKg: asNumber(cells[9]),
          ingredients: [],
          packaging: [],
          warnings: [],
        };
        state = 'expect_ingredients_header';
        continue;
      }
    }

    if (state === 'expect_product_values') {
      // The first row after "Nazwa produktu" — column A is the product name,
      // column B is the capacity, column I is MOQ, column J is sachet mass.
      const name = asString(cells[0]);
      if (!name) {
        // Bad/empty header — abort this block.
        state = 'idle';
        continue;
      }
      current = {
        name,
        capacityMl: asNumber(cells[1]),
        moqUnits: asNumber(cells[8]),
        sachetMassKg: asNumber(cells[9]),
        ingredients: [],
        packaging: [],
        warnings: [],
      };
      state = 'expect_ingredients_header';
      continue;
    }

    if (cls.kind === 'ingredients_header') {
      if (current) state = 'reading_ingredients';
      continue;
    }

    if (cls.kind === 'components_marker') {
      if (current) state = 'reading_primary_components';
      continue;
    }

    if (cls.kind === 'others_marker') {
      if (current) state = 'reading_secondary_components';
      continue;
    }

    if (cls.kind === 'water' && current && state === 'reading_ingredients') {
      // Per product spec we don't model "Woda / do 100%" in the recipe.
      continue;
    }

    if (cls.kind === 'ingredient' && current && state === 'reading_ingredients') {
      // Capture Przelicznik from column C (index 2) of the first ingredient row.
      if (current.przelicznikG === undefined) {
        const przel = asNumber(cells[2]);
        if (przel !== undefined) current.przelicznikG = przel;
      }
      current.ingredients.push({
        name: cls.name,
        percentage: cls.percentage,
        pricePerKg: cls.pricePerKg,
        channel: cls.channel,
      });
      continue;
    }

    if (cls.kind === 'packaging' && current) {
      if (state === 'reading_primary_components') {
        current.packaging.push({ name: cls.name, section: 'primary' });
      } else if (state === 'reading_secondary_components') {
        current.packaging.push({
          name: cls.name,
          section: 'secondary',
          capacityHint: cls.capacityHint,
          capacityUnitHint: cls.capacityUnitHint,
        });
      } else {
        // Stray name-only row outside any section. Skip and warn.
        current.warnings.push(`Pominięto wiersz „${cls.name}" — nie należy do żadnej sekcji.`);
      }
      continue;
    }

    if (cls.kind === 'konfekcja' && current) {
      // Last block's first konfekcja line wins. If the file has multiple
      // (shouldn't), the user's intent is the first one; subsequent ones
      // are ignored with a warning so the user notices the data oddity.
      if (current.conversionLaborCost === undefined) {
        current.conversionLaborCost = cls.cost;
      } else if (cls.cost !== undefined && cls.cost !== current.conversionLaborCost) {
        current.warnings.push(
          `Drugi wiersz „Konfekcja" zawiera inną wartość (${cls.cost}) niż pierwszy (${current.conversionLaborCost}) — użyto pierwszej.`,
        );
      }
      continue;
    }

    // Unknown / unexpected row — only warn while a block is open. We already
    // consumed expect_product_values above, so any unknown row here is past
    // the header strip.
    if (current && cls.kind === 'unknown') {
      const text = cells.map(asString).filter(Boolean).join(' | ');
      if (text) current.warnings.push(`Nieznany wiersz pominięty: ${text}`);
    }
  }

  finishBlock();
  return blocks;
}

// ---------- catalog resolution (analyze + commit phases) ----------

// Walks the parsed blocks and returns the unique set of raw / component names
// that the file references but the catalog (+ stored aliases) cannot resolve.
// First-seen `channel` / `section` wins so the eventual add-new respects the
// file's intent. Used by the analyze phase to drive the resolution modal.
function collectUnresolved(
  blocks: RecipeBlock[],
  rawIdx: CatalogIndex<RawMaterial>,
  compIdx: CatalogIndex<PackagingComponent>,
): {
  raws: Map<string, { item: RecipeImportUnresolvedItem }>;
  comps: Map<string, { item: RecipeImportUnresolvedItem }>;
} {
  const raws = new Map<string, { item: RecipeImportUnresolvedItem }>();
  const comps = new Map<string, { item: RecipeImportUnresolvedItem }>();

  for (const block of blocks) {
    for (const ing of block.ingredients) {
      const sink: string[] = [];
      const hit = lookupExisting(rawIdx, ing.name, sink);
      if (hit) continue;
      const key = smartNormalize(ing.name);
      const existing = raws.get(key);
      if (existing) {
        if (!existing.item.productNames.includes(block.name)) {
          existing.item.productNames.push(block.name);
        }
      } else {
        raws.set(key, {
          item: {
            name: ing.name,
            channel: ing.channel,
            productNames: [block.name],
            suggestions: suggestMatches(
              { name: ing.name },
              Array.from(rawIdx.byId.values()),
              { limit: 3 },
            ),
          },
        });
      }
    }
    for (const pkg of block.packaging) {
      const sink: string[] = [];
      const hit = lookupExisting(compIdx, pkg.name, sink);
      if (hit) continue;
      const key = smartNormalize(pkg.name);
      const existing = comps.get(key);
      if (existing) {
        if (!existing.item.productNames.includes(block.name)) {
          existing.item.productNames.push(block.name);
        }
      } else {
        comps.set(key, {
          item: {
            name: pkg.name,
            section: pkg.section,
            productNames: [block.name],
            suggestions: suggestMatches(
              { name: pkg.name },
              Array.from(compIdx.byId.values()),
              { limit: 3 },
            ),
          },
        });
      }
    }
  }
  return { raws, comps };
}

// Apply user resolutions to the catalog before the main import walk. Mutates
// `idx` so subsequent `lookupExisting` calls find the resolved target. Returns
// counts of newly-created items so the summary stays accurate.
async function applyResolutions<T extends { id: string; name: string }>(
  resolutions: RecipeImportResolutionEntry[],
  idx: CatalogIndex<T>,
  createItem: (name: string, sourceName: string) => Promise<T>,
  rename: (id: string, newName: string) => Promise<T>,
  addAlias: (targetId: string, alias: string) => Promise<unknown>,
  warnings: string[],
): Promise<{ created: number; resolvedByName: Map<string, T> }> {
  const created = { value: 0 };
  // Caller looks up by exact file-name during the commit walk, so we key the
  // resolution map by smart-normalized name to match `lookupExisting`'s key.
  const resolvedByName = new Map<string, T>();

  for (const r of resolutions) {
    const key = smartNormalize(r.name);
    if (r.action.type === 'add-new') {
      const item = await createItem(r.name.trim(), r.name);
      indexAdd(idx, item);
      created.value++;
      resolvedByName.set(key, item);
    } else if (r.action.type === 'save-alias') {
      const target = idx.byId.get(r.action.targetId);
      if (!target) {
        warnings.push(
          `Nie znaleziono docelowej pozycji dla aliasu "${r.name}" — pominięto.`,
        );
        continue;
      }
      await addAlias(target.id, r.name);
      idx.aliasMap.set(key, target.id);
      resolvedByName.set(key, target);
    } else if (r.action.type === 'rename-existing') {
      const target = idx.byId.get(r.action.targetId);
      if (!target) {
        warnings.push(
          `Nie znaleziono pozycji do przemianowania na "${r.name}" — pominięto.`,
        );
        continue;
      }
      const updated = await rename(target.id, r.name.trim());
      indexAdd(idx, updated);
      resolvedByName.set(key, updated);
    }
  }

  return { created: created.value, resolvedByName };
}

// Lookup that also consults the per-import resolutions map. Used during the
// commit walk so resolved names find their target even when `lookupExisting`
// would miss (e.g. add-new entries whose names don't equal the row name yet).
function lookupWithResolutions<T extends { id: string; name: string }>(
  idx: CatalogIndex<T>,
  resolvedByName: Map<string, T>,
  name: string,
  warnings: string[],
): T | undefined {
  const existing = lookupExisting(idx, name, warnings);
  if (existing) return existing;
  return resolvedByName.get(smartNormalize(name));
}

// ---------- main import ----------

export async function parseRecipesXlsx(filePath: string): Promise<RecipeBlock[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`No worksheet in ${filePath}`);
  return extractBlocks(ws);
}

// Two-phase import. Phase 1 (`analyzeRecipesXlsx`) parses the file and reports
// every raw material / component the file references that the catalog cannot
// resolve, so the renderer can show a resolution modal. Phase 2
// (`commitRecipesXlsx`) is called with the user's per-item decisions, applies
// them to the catalog, and then performs the actual product upserts. This
// removes the previous silent auto-create behaviour: a name from the file is
// only added to the catalog when the user explicitly picks "add-new".

async function buildIndexes(
  db: Database,
): Promise<{
  rawIdx: CatalogIndex<RawMaterial>;
  compIdx: CatalogIndex<PackagingComponent>;
  productIdx: CatalogIndex<Product>;
  products: Product[];
}> {
  const rawMaterials = await db.listRawMaterials();
  const components = await db.listComponents();
  const products = await db.listProducts();
  // Alias tables may not be migrated yet; database.ts returns [] in that case.
  const rawAliases = await db.listRawMaterialAliases();
  const compAliases = await db.listComponentAliases();
  const rawIdx = buildIndex(
    rawMaterials,
    rawAliases.map((a) => ({ alias: a.alias, targetId: a.targetId })),
  );
  const compIdx = buildIndex(
    components,
    compAliases.map((a) => ({ alias: a.alias, targetId: a.targetId })),
  );
  const productIdx = buildIndex<Product>(products, []);
  return { rawIdx, compIdx, productIdx, products };
}

export async function analyzeRecipesXlsx(
  filePath: string,
  mode: RecipeImportMode,
  db: Database,
): Promise<RecipeImportAnalysis> {
  const blocks = await parseRecipesXlsx(filePath);
  log.info(
    `[recipes-analyze] parsed ${blocks.length} recipe blocks from ${path.basename(filePath)}`,
  );
  const { rawIdx, compIdx } = await buildIndexes(db);
  const { raws, comps } = collectUnresolved(blocks, rawIdx, compIdx);
  return {
    fileName: path.basename(filePath),
    filePath,
    mode,
    blockCount: blocks.length,
    unresolvedRaws: Array.from(raws.values()).map((r) => r.item),
    unresolvedComponents: Array.from(comps.values()).map((c) => c.item),
  };
}

export async function commitRecipesXlsx(
  filePath: string,
  mode: RecipeImportMode,
  resolutions: RecipeImportResolutions,
  db: Database,
): Promise<RecipeImportSummary> {
  const blocks = await parseRecipesXlsx(filePath);
  log.info(
    `[recipes-commit] parsed ${blocks.length} recipe blocks from ${path.basename(filePath)}`,
  );

  const summary: RecipeImportSummary = {
    fileName: path.basename(filePath),
    mode,
    productsCreated: 0,
    productsUpdated: 0,
    productsSkipped: 0,
    rawMaterialsCreated: 0,
    componentsCreated: 0,
    perProduct: [],
    globalWarnings: [],
  };

  const { rawIdx, compIdx, productIdx, products } = await buildIndexes(db);

  // Apply the user's resolutions first — this teaches the indexes about new
  // catalog entries, new aliases, and rename'd items so the block walk below
  // resolves every referenced name. Resolutions for items the user picked
  // "add-new" on need section/channel info from the file to set fields like
  // factorySupplied or component type; we look those up by re-walking blocks.
  const rawHints = new Map<string, { channel?: 'MY' | 'RETTER' }>();
  const compHints = new Map<
    string,
    {
      section: 'primary' | 'secondary';
      capacityHint?: number;
      capacityUnitHint?: PackingCapacityUnit;
    }
  >();
  for (const b of blocks) {
    for (const ing of b.ingredients) {
      const k = smartNormalize(ing.name);
      if (!rawHints.has(k)) rawHints.set(k, { channel: ing.channel });
    }
    for (const pkg of b.packaging) {
      const k = smartNormalize(pkg.name);
      if (!compHints.has(k)) {
        compHints.set(k, {
          section: pkg.section,
          capacityHint: pkg.capacityHint,
          capacityUnitHint: pkg.capacityUnitHint,
        });
      }
    }
  }

  const rawApplied = await applyResolutions<RawMaterial>(
    resolutions.rawMaterials,
    rawIdx,
    async (cleanName, sourceName) => {
      const hint = rawHints.get(smartNormalize(sourceName));
      return db.createRawMaterial({
        name: cleanName,
        unit: 'kg',
        supplierIds: [],
        // MY/RETTER governs whether the factory supplies the material.
        // RETTER means the factory keeps it on site; MY means we source it.
        factorySupplied: hint?.channel === 'RETTER',
      });
    },
    (id, newName) => db.updateRawMaterial(id, { name: newName }),
    (targetId, alias) => db.addRawMaterialAlias(targetId, alias),
    summary.globalWarnings,
  );
  const compApplied = await applyResolutions<PackagingComponent>(
    resolutions.components,
    compIdx,
    async (cleanName, sourceName) => {
      const hint = compHints.get(smartNormalize(sourceName));
      const type = inferComponentType(cleanName, hint?.section ?? 'primary');
      // Seed total capacity on the component from the file (column B in the
      // "Pozostałe komponenty" section) — e.g. "Karton zbiorczy | 50" means
      // 50 slots per carton. Without a hint, leave undefined and flag the
      // tier for review.
      const isSecondary = (hint?.section ?? 'primary') === 'secondary';
      const capacity =
        isSecondary && hint?.capacityHint && hint.capacityHint > 0
          ? hint.capacityHint
          : undefined;
      const capacityUnit: PackingCapacityUnit | undefined = isSecondary
        ? hint?.capacityUnitHint ?? (type === 'barrel' ? 'l' : 'units')
        : undefined;
      return db.createComponent({
        name: cleanName,
        type,
        supplierIds: [],
        capacity,
        capacityUnit,
      });
    },
    (id, newName) => db.updateComponent(id, { name: newName }),
    (targetId, alias) => db.addComponentAlias(targetId, alias),
    summary.globalWarnings,
  );

  // In "overwrite" mode the file is the full source of truth — wipe products
  // that don't appear in the file. Catalog entries are kept either way; only
  // products are subject to the wipe. Respect smart-key matches so "Krem X"
  // in the file doesn't accidentally delete "Krem X (2025)" from the catalog.
  if (mode === 'overwrite') {
    const incomingNames = new Set(blocks.map((b) => normalize(b.name)));
    const aliasKeptIds = new Set<string>();
    for (const b of blocks) {
      const smartHits = productIdx.smartByKey.get(smartNormalize(b.name)) ?? [];
      if (smartHits.length === 1) aliasKeptIds.add(smartHits[0].id);
    }
    for (const p of products) {
      if (incomingNames.has(normalize(p.name))) continue;
      if (aliasKeptIds.has(p.id)) continue;
      await db.deleteProduct(p.id);
    }
  }

  for (const block of blocks) {
    const result: RecipeImportProductResult = {
      productName: block.name,
      action: 'skipped',
      capacityMl: block.capacityMl,
      ingredientCount: 0,
      packagingCount: 0,
      schemeTierCount: 0,
      schemeCapacityReviewNeeded: [],
      warnings: [...block.warnings],
    };

    if (!block.name.trim() || !block.capacityMl) {
      result.warnings.push('Brak nazwy lub pojemności — produkt pominięto.');
      summary.perProduct.push(result);
      summary.productsSkipped++;
      continue;
    }

    // Derive density from Przelicznik (= capacity * density * 1.05). When the
    // multiplier is missing (rare — e.g. user typed % values without batch
    // sizes) we fall back to 1.0 and warn.
    let density = 1.0;
    if (block.przelicznikG !== undefined) {
      density = block.przelicznikG / (block.capacityMl * RECIPE_WASTE_MARGIN);
      if (!Number.isFinite(density) || density <= 0) {
        result.warnings.push(
          `Nieprawidłowy Przelicznik (${block.przelicznikG}) — gęstość ustawiono na 1.0.`,
        );
        density = 1.0;
      }
    } else {
      result.warnings.push('Brak wartości Przelicznik — gęstość ustawiono na 1.0.');
    }

    // Resolve raw materials. After applyResolutions every referenced name
    // should resolve; if any still doesn't, the file changed between
    // analyze and commit — skip the product and warn rather than silently
    // creating a partial recipe.
    const ingredients: Product['ingredients'] = [];
    let sumPct = 0;
    let missing = false;
    for (const ing of block.ingredients) {
      const rm = lookupWithResolutions(
        rawIdx,
        rawApplied.resolvedByName,
        ing.name,
        summary.globalWarnings,
      );
      if (!rm) {
        result.warnings.push(`Brak surowca w katalogu: „${ing.name}" — produkt pominięto.`);
        missing = true;
        break;
      }
      ingredients.push({ rawMaterialId: rm.id, percentage: ing.percentage });
      sumPct += ing.percentage;
    }
    if (missing) {
      summary.perProduct.push(result);
      summary.productsSkipped++;
      continue;
    }
    if (sumPct > 100.0001) {
      result.warnings.push(
        `Suma % w recepturze wynosi ${sumPct.toFixed(3)} — przekracza 100. Produkt zaimportowany, ale popraw recepturę w aplikacji.`,
      );
    }

    // Resolve packaging. Primary components keep their 1:1 entry in
    // `packaging[]` (one per product unit). Secondary components — outer
    // cartons, tape, barrels, bags — go into `packingScheme.tiers[]` because
    // they cover many units per piece, with a per-tier capacity.
    const packaging: Product['packaging'] = [];
    const schemeTiers: PackingTier[] = [];
    for (const pkg of block.packaging) {
      const comp = lookupWithResolutions(
        compIdx,
        compApplied.resolvedByName,
        pkg.name,
        summary.globalWarnings,
      );
      if (!comp) {
        result.warnings.push(
          `Brak komponentu w katalogu: „${pkg.name}" — produkt pominięto.`,
        );
        missing = true;
        break;
      }
      if (isSecondaryComponent(comp.type)) {
        // Capacity lives on the component; tier stores per-product consumption.
        // Default consumption: 1 (one slot / one piece per product). For
        // kg/l, walkSchemeConsumption auto-derives from product mass/volume
        // unless the user later sets `consumptionOverride: true`.
        const needsReview =
          !comp.capacity || comp.capacity <= 0;
        schemeTiers.push({
          componentId: comp.id,
          consumption: 1,
          note: needsReview ? 'IMPORT — uzupełnij pojemność komponentu' : undefined,
        });
        if (needsReview) result.schemeCapacityReviewNeeded.push(comp.name);
      } else {
        packaging.push({ componentId: comp.id, qtyPerUnit: 1 });
      }
    }
    if (missing) {
      summary.perProduct.push(result);
      summary.productsSkipped++;
      continue;
    }

    result.ingredientCount = ingredients.length;
    result.packagingCount = packaging.length;
    result.schemeTierCount = schemeTiers.length;

    const existing = lookupExisting(productIdx, block.name, summary.globalWarnings);
    const payload = {
      name: block.name.trim(),
      capacityMl: block.capacityMl,
      densityGPerMl: density,
      moqUnits: block.moqUnits,
      sachetMassKg: block.sachetMassKg,
      // Konfekcja value from the file maps directly onto the product's
      // labour-cost field. Undefined when the file doesn't have a Konfekcja
      // line; merge/overwrite branches below decide how to combine with any
      // value the user previously typed.
      conversionLaborCost: block.conversionLaborCost,
      ingredients,
      packaging,
      packingScheme: schemeTiers.length > 0 ? { tiers: schemeTiers } : undefined,
      archived: false,
    };

    if (existing) {
      const patch =
        mode === 'merge'
          ? {
              // Merge: replace recipe contents, keep manual fields the user
              // may have filled in (sku, notes, sachetsCount). Konfekcja
              // value from the file wins when present — that's the whole
              // point — but a missing line keeps whatever the user already
              // had. Same rule for `packingScheme`: file overrides only when
              // it provides tiers; absent → keep user's edits.
              ...payload,
              sku: existing.sku,
              conversionLaborCost:
                block.conversionLaborCost ?? existing.conversionLaborCost,
              packingScheme:
                schemeTiers.length > 0 ? { tiers: schemeTiers } : existing.packingScheme,
              notes: existing.notes,
              sachetsCount: existing.sachetsCount,
              archived: existing.archived,
            }
          : {
              // Overwrite: file wins for everything except sachetsCount (not
              // in file). conversionLaborCost included via payload spread.
              ...payload,
              sachetsCount: existing.sachetsCount,
            };
      // Suppress no-op updates so the summary doesn't claim "X produktów
      // zaktualizowano" when the file matches what's already in the DB.
      if (!productPatchHasChanges(existing, patch)) {
        result.action = 'skipped';
        summary.perProduct.push(result);
        continue;
      }
      const updated = await db.updateProduct(existing.id, patch);
      indexAdd(productIdx, updated);
      result.action = 'updated';
      summary.productsUpdated++;
    } else {
      // Fuzzy near-duplicate check before create.
      const top = suggestMatches({ name: block.name }, Array.from(productIdx.byId.values()), {
        limit: 1,
        threshold: 0.85,
      })[0];
      if (top) {
        summary.globalWarnings.push(
          `Możliwy duplikat produktu: "${block.name}" wygląda jak istniejący "${top.name}" (${Math.round(top.confidence * 100)}%).`,
        );
      }
      const created = await db.createProduct(payload);
      indexAdd(productIdx, created);
      result.action = 'created';
      summary.productsCreated++;
    }

    summary.perProduct.push(result);
  }

  summary.rawMaterialsCreated = rawApplied.created;
  summary.componentsCreated = compApplied.created;

  if (summary.productsCreated === 0 && summary.productsUpdated === 0) {
    summary.globalWarnings.push('Nie udało się odczytać żadnej receptury. Sprawdź format pliku.');
  }

  return summary;
}

// ---------- export ----------

export async function exportRecipesXlsx(filePath: string, db: Database): Promise<void> {
  const products = await db.listProducts();
  const rawMaterials = await db.listRawMaterials();
  const components = await db.listComponents();

  const rawById = new Map(rawMaterials.map((r) => [r.id, r]));
  const compById = new Map(components.map((c) => [c.id, c]));

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Cutis Production Planner';
  wb.created = new Date();
  const ws = wb.addWorksheet('Plik z recepturami');

  // Column widths roughly match the original file so the export opens nicely.
  ws.columns = [
    { width: 50 }, // A name
    { width: 14 }, // B %
    { width: 22 }, // C przelicznik
    { width: 14 }, // D ilość g
    { width: 14 }, // E cena/kg
    { width: 14 }, // F cena/g
    { width: 16 }, // G wartość
    { width: 14 }, // H MY/RETTER
    { width: 12 }, // I MOQ
    { width: 18 }, // J masa saszetki
  ];

  // Sort by name for stable output (matches what listProducts returns anyway).
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name));

  for (const p of sorted) {
    const przelG = p.capacityMl * p.densityGPerMl * RECIPE_WASTE_MARGIN;

    // Product header strip.
    ws.addRow([
      'Nazwa produktu',
      'Pojemność [ml]',
      null,
      null,
      null,
      null,
      null,
      null,
      'MOQ [szt.]',
      'Masa na saszetki [kg]',
    ]);
    ws.addRow([
      p.name,
      p.capacityMl,
      null,
      null,
      null,
      null,
      null,
      null,
      p.moqUnits ?? null,
      p.sachetMassKg ?? null,
    ]);

    // Ingredient block header.
    ws.addRow([
      'Surowce',
      'Zawartość %',
      'Przelicznik + 5% [g]',
      'Ilość w g',
      'Cena surowca [kg]',
      'Cena surowca [g]',
      'Wartość/produkt',
      'Dostępność',
      null,
      null,
    ]);

    // Reserve a "Woda / do 100%" line when the recipe leaves headroom < 100%.
    const sumPct = p.ingredients.reduce((acc, i) => acc + (i.percentage || 0), 0);
    if (sumPct < 99.9999) {
      ws.addRow(['Woda', 'do 100%', null, null, null, null, null, null, null, null]);
    }

    for (const ing of p.ingredients) {
      const rm = rawById.get(ing.rawMaterialId);
      const name = rm?.name ?? '(usunięty surowiec)';
      const pricePerKg = rm?.lastPurchasePriceNet;
      const pricePerG = typeof pricePerKg === 'number' ? pricePerKg / 1000 : undefined;
      const qtyG = (ing.percentage / 100) * przelG;
      const valuePerProduct = pricePerG !== undefined ? qtyG * pricePerG : undefined;
      const channel = rm?.factorySupplied ? 'RETTER' : 'MY';
      ws.addRow([
        name,
        ing.percentage,
        przelG,
        qtyG,
        pricePerKg ?? null,
        pricePerG ?? null,
        valuePerProduct ?? null,
        channel,
        null,
        null,
      ]);
    }

    // Primary packaging: 1:1 entries from `packaging[]`. Secondary packaging
    // comes from `packingScheme.tiers[]`. Total capacity now lives on the
    // component, so the exported row shows `componentName | capacity | unit`.
    const primary: { name: string }[] = [];
    const secondary: { name: string; capacity?: number; unit?: 'units' | 'kg' | 'l' | 'm' }[] = [];
    for (const pk of p.packaging) {
      const c = compById.get(pk.componentId);
      if (!c) continue;
      if (isSecondaryComponent(c.type)) {
        secondary.push({ name: c.name });
      } else {
        primary.push({ name: c.name });
      }
    }
    for (const tier of p.packingScheme?.tiers ?? []) {
      const c = compById.get(tier.componentId);
      if (!c) continue;
      secondary.push({ name: c.name, capacity: c.capacity, unit: c.capacityUnit });
    }

    ws.addRow(['Komponenty', null, null, null, null, null, null, null, null, null]);
    for (const pk of primary) {
      ws.addRow([pk.name, null, null, null, null, null, null, null, null, null]);
    }

    if (secondary.length > 0) {
      ws.addRow(['Pozostałe komponenty', null, null, null, null, null, null, null, null, null]);
      for (const pk of secondary) {
        // Column B: capacity (e.g. 50 = "50 produktów / 1 karton"). Column C:
        // capacity unit hint when not the default 'units'. The importer
        // already accepts an optional numeric capacity in column B.
        ws.addRow([
          pk.name,
          pk.capacity ?? null,
          pk.unit && pk.unit !== 'units' ? pk.unit : null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ]);
      }
    }

    // Konfekcja row — labour cost per unit. Round-trip symmetry with the
    // importer: value lands in column G ("Wartość"), same column we read
    // during import.
    if (typeof p.conversionLaborCost === 'number' && p.conversionLaborCost > 0) {
      ws.addRow([
        'Konfekcja',
        null,
        null,
        null,
        null,
        null,
        p.conversionLaborCost,
        null,
        null,
        null,
      ]);
    }

    // Suma row — column G with the unit cost from the recipe.
    const unitCost = p.ingredients.reduce((acc, ing) => {
      const rm = rawById.get(ing.rawMaterialId);
      const pricePerKg = rm?.lastPurchasePriceNet;
      if (typeof pricePerKg !== 'number') return acc;
      const qtyG = (ing.percentage / 100) * przelG;
      return acc + qtyG * (pricePerKg / 1000);
    }, 0);
    ws.addRow([null, null, null, null, null, 'Suma', unitCost || null, null, null, null]);

    // Empty separator row.
    ws.addRow([null, null, null, null, null, null, null, null, null, null]);
  }

  await wb.xlsx.writeFile(filePath);
  log.info(`[recipes-export] wrote ${sorted.length} recipes to ${path.basename(filePath)}`);
}
