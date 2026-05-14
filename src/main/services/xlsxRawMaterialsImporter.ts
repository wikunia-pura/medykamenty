// Import the "Plik z surowcami.xlsx" file — the buyer's source of truth for
// every raw material the company buys: which supplier, contact person, price,
// package size, payment terms, ordering notes. One row = one raw material with
// exactly one supplier; many raw materials share suppliers, so the importer
// runs in two passes:
//   1. Upsert every unique supplier mentioned in the file
//   2. Upsert every raw material and link it to its supplier
//
// Merge strategy (conservative — chosen by the user):
//   * Existing supplier/raw material is matched by case-insensitive trimmed
//     name. Manually edited fields are preserved; only empty fields get
//     filled in from the file.
//   * Exceptions, where the file is treated as fresh source of truth:
//       - lastPurchasePriceNet, currency  → always overwritten
//       - moq (from "Wielkość opakowania" when it parses to a number) → always
//       - preferredSupplierId on the raw material → always set to the supplier
//         from this row (the file represents the canonical primary supplier)
//   * "Uwagi" describe HOW to order from the supplier (portal links, account
//     credentials), so it goes on Supplier.notes. Appended if a different
//     value is already there.
//   * Package size that comes as a range (e.g. "0,5-25") cannot be turned into
//     a numeric MOQ; it is appended to the raw material's notes instead.

import ExcelJS from 'exceljs';
import path from 'path';
import type Database from '../database';
import type {
  RawMaterial,
  RawMaterialsImportMode,
  RawMaterialsImportSummary,
  Supplier,
  Unit,
} from '../../shared/types';
import log from '../utils/logger';
import { normalize as smartNormalize, suggestMatches } from './smartMatcher';

interface ColumnMap {
  name: number;
  symbol?: number;
  currency?: number;
  oNet?: number; // ONetto (Z) — purchase net price per kg
  supplier?: number;
  contactPerson?: number;
  email?: number;
  phone?: number;
  packageSize?: number;
  paymentTerms?: number;
  notes?: number;
}

// ---------- normalization helpers ----------

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
      const joined = parts
        .map((p) => p?.text ?? '')
        .join('')
        .trim();
      // The richText payload sometimes carries trailing markup characters
      // (e.g. ">") from broken spreadsheet edits — strip them.
      const cleaned = joined.replace(/[<>]+$/, '').trim();
      return cleaned.length === 0 ? undefined : cleaned;
    }
    if ('result' in v) return asString((v as { result: unknown }).result);
    if ('hyperlink' in v) return asString((v as { hyperlink: unknown }).hyperlink);
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

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------- header detection ----------

function detectColumns(headerRow: ExcelJS.Row): ColumnMap | null {
  const map: Partial<ColumnMap> = {};
  headerRow.eachCell((cell, col) => {
    const raw = asString(cell.value) ?? '';
    const lower = raw.toLowerCase();
    if (lower.startsWith('nazwa surowca') || lower === 'nazwa' || lower === 'name')
      map.name = col;
    else if (lower === 'symbol') map.symbol = col;
    else if (lower === 'waluta' || lower === 'currency') map.currency = col;
    else if (lower.startsWith('onetto')) map.oNet = col;
    else if (lower === 'dostawca' || lower === 'supplier') map.supplier = col;
    else if (lower.startsWith('osoba kontaktowa') || lower === 'contact person')
      map.contactPerson = col;
    else if (lower === 'mail' || lower === 'e-mail' || lower === 'email') map.email = col;
    else if (lower.startsWith('nr telefonu') || lower === 'telefon' || lower === 'phone')
      map.phone = col;
    else if (lower.startsWith('wielkość opakowania') || lower.startsWith('wielkosc opakowania'))
      map.packageSize = col;
    else if (lower.startsWith('warunki płatności') || lower.startsWith('warunki platnosci'))
      map.paymentTerms = col;
    else if (lower === 'uwagi' || lower === 'notes') map.notes = col;
  });
  if (!map.name || !map.supplier) return null;
  return map as ColumnMap;
}

function findHeaderRow(ws: ExcelJS.Worksheet): { row: ExcelJS.Row; columns: ColumnMap } | null {
  const limit = Math.min(20, ws.rowCount);
  for (let i = 1; i <= limit; i++) {
    const row = ws.getRow(i);
    const cols = detectColumns(row);
    if (cols) return { row, columns: cols };
  }
  return null;
}

// ---------- merge helpers ----------

function mergeNotes(existing: string | undefined, incoming: string | undefined): string | undefined {
  const a = existing?.trim();
  const b = incoming?.trim();
  if (!a) return b || undefined;
  if (!b) return a;
  if (a.toLowerCase() === b.toLowerCase()) return a;
  if (a.toLowerCase().includes(b.toLowerCase())) return a;
  return `${a}\n${b}`;
}

function fillIfEmpty<T>(existing: T | undefined, incoming: T | undefined): T | undefined {
  if (existing === undefined || existing === null) return incoming;
  if (typeof existing === 'string' && existing.trim() === '') return incoming ?? existing;
  return existing;
}

// Compare a Partial<RawMaterial> patch to the current entity. Order-insensitive
// for supplierIds (the array can be reshuffled between imports without
// representing a real change). Used to suppress no-op updates so the import
// summary doesn't claim "X surowców zaktualizowanych" when nothing changed.
function rawPatchHasChanges(existing: RawMaterial, patch: Partial<RawMaterial>): boolean {
  for (const [key, value] of Object.entries(patch) as [keyof RawMaterial, unknown][]) {
    if (key === 'supplierIds') {
      const a = (existing.supplierIds ?? []).slice().sort();
      const b = ((value as string[] | undefined) ?? []).slice().sort();
      if (a.length !== b.length) return true;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
      continue;
    }
    if (existing[key] !== value) return true;
  }
  return false;
}

// ---------- main entry point ----------

export async function importRawMaterialsXlsx(
  filePath: string,
  mode: RawMaterialsImportMode,
  db: Database,
): Promise<RawMaterialsImportSummary> {
  const summary: RawMaterialsImportSummary = {
    mode,
    rawCreated: 0,
    rawUpdated: 0,
    rawSkipped: 0,
    rawDeleted: 0,
    suppliersCreated: 0,
    suppliersUpdated: 0,
    warnings: [],
  };

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error(`No worksheet in ${filePath}`);

  const header = findHeaderRow(ws);
  if (!header) {
    throw new Error(
      `Nie rozpoznano nagłówków pliku. Wymagane kolumny: "Nazwa surowca" oraz "Dostawca".`,
    );
  }
  const { row: headerRow, columns } = header;

  // ---------- collect rows ----------
  interface ParsedRow {
    name: string;
    supplierName: string;
    contactPerson?: string;
    email?: string;
    phone?: string;
    paymentTerms?: string;
    supplierNotes?: string;
    purchaseNet?: number;
    currency?: string;
    packageSizeKg?: number;
    packageSizeRaw?: string;
  }

  const parsed: ParsedRow[] = [];
  for (let i = headerRow.number + 1; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const name = asString(r.getCell(columns.name).value);
    if (!name) continue;
    const supplierName = columns.supplier
      ? asString(r.getCell(columns.supplier).value)
      : undefined;
    if (!supplierName) {
      summary.rawSkipped++;
      summary.warnings.push(`Wiersz ${i} ("${name}") nie ma dostawcy — pomijam.`);
      continue;
    }

    const packageRaw = columns.packageSize
      ? asString(r.getCell(columns.packageSize).value)
      : undefined;
    // A package size like "0,5-25" or "0.5 - 60" is a range, not a single
    // value. parseFloat would silently return the first number (0.5), which
    // would be a misleading MOQ. Detect ranges first and keep them as raw
    // text only — moq stays empty for ranges.
    const looksLikeRange = !!packageRaw && /\d[\s,.\d]*-\s*\d/.test(packageRaw);
    const packageNum =
      columns.packageSize && !looksLikeRange
        ? asNumber(r.getCell(columns.packageSize).value)
        : undefined;

    parsed.push({
      name,
      supplierName,
      contactPerson: columns.contactPerson
        ? asString(r.getCell(columns.contactPerson).value)
        : undefined,
      email: columns.email ? asString(r.getCell(columns.email).value) : undefined,
      phone: columns.phone ? asString(r.getCell(columns.phone).value) : undefined,
      paymentTerms: columns.paymentTerms
        ? asString(r.getCell(columns.paymentTerms).value)
        : undefined,
      supplierNotes: columns.notes ? asString(r.getCell(columns.notes).value) : undefined,
      purchaseNet: columns.oNet ? asNumber(r.getCell(columns.oNet).value) : undefined,
      currency: columns.currency ? asString(r.getCell(columns.currency).value) : undefined,
      packageSizeKg: packageNum,
      // Keep the raw cell text only when it would not round-trip to a number
      // (e.g. "0,5-25"). Otherwise it'd duplicate moq.
      packageSizeRaw: packageNum === undefined ? packageRaw : undefined,
    });
  }

  // ---------- pass 1: suppliers ----------
  // Filter to skip placeholder rows like "Nieznany" supplier with no contact data.
  const allSuppliers = await db.listSuppliers();
  const supplierByKey = new Map<string, Supplier>();
  for (const s of allSuppliers) supplierByKey.set(normalizeKey(s.name), s);

  // Aggregate per-supplier data from the file (a supplier can appear in many
  // rows with slightly different supplementary info; pick the first non-empty
  // for each scalar field, merge notes).
  const supplierAgg = new Map<
    string,
    {
      name: string;
      contactPerson?: string;
      email?: string;
      phone?: string;
      paymentTerms?: string;
      notes?: string;
    }
  >();
  for (const row of parsed) {
    const key = normalizeKey(row.supplierName);
    const cur = supplierAgg.get(key) ?? { name: row.supplierName.trim() };
    cur.contactPerson = cur.contactPerson ?? row.contactPerson;
    cur.email = cur.email ?? row.email;
    cur.phone = cur.phone ?? row.phone;
    cur.paymentTerms = cur.paymentTerms ?? row.paymentTerms;
    cur.notes = mergeNotes(cur.notes, row.supplierNotes);
    supplierAgg.set(key, cur);
  }

  for (const [key, agg] of supplierAgg.entries()) {
    const existing = supplierByKey.get(key);
    if (existing) {
      const patch: Partial<Supplier> = {
        email: existing.email && existing.email.trim() !== '' ? existing.email : (agg.email ?? ''),
        phone: fillIfEmpty(existing.phone, agg.phone),
        contactPerson: fillIfEmpty(existing.contactPerson, agg.contactPerson),
        paymentTerms: fillIfEmpty(existing.paymentTerms, agg.paymentTerms),
        notes: mergeNotes(existing.notes, agg.notes),
      };
      const changed =
        patch.email !== existing.email ||
        patch.phone !== existing.phone ||
        patch.contactPerson !== existing.contactPerson ||
        patch.paymentTerms !== existing.paymentTerms ||
        patch.notes !== existing.notes;
      if (changed) {
        const updated = await db.updateSupplier(existing.id, patch);
        supplierByKey.set(key, updated);
        summary.suppliersUpdated++;
      }
    } else {
      const created = await db.createSupplier({
        name: agg.name,
        email: agg.email ?? '',
        phone: agg.phone,
        contactPerson: agg.contactPerson,
        paymentTerms: agg.paymentTerms,
        notes: agg.notes,
        preferredEmailLanguage: 'pl',
      });
      supplierByKey.set(key, created);
      summary.suppliersCreated++;
    }
  }

  // ---------- pass 2: raw materials ----------
  const allRaw = await db.listRawMaterials();
  const rawByKey = new Map<string, RawMaterial>();
  for (const rm of allRaw) rawByKey.set(normalizeKey(rm.name), rm);

  // Aliases learned from stock import: incoming names that have been mapped to
  // an existing raw material should target that catalog entry instead of
  // creating a duplicate. Falls back to empty silently if the table doesn't
  // exist yet (schema not migrated).
  const aliases = await db.listRawMaterialAliases();
  const aliasMap = new Map<string, string>();
  for (const a of aliases) aliasMap.set(smartNormalize(a.alias), a.targetId);
  const rawById = new Map<string, RawMaterial>();
  for (const rm of allRaw) rawById.set(rm.id, rm);

  // Smart-normalized index: maps an aggressively-normalized name (diacritics
  // stripped, parenthetical suffixes removed, units dropped) to the catalog
  // entries that hit it. Used as a fallback when exact normalizeKey lookup
  // misses but the names are obviously the same item — e.g. catalog has
  // "Allantoina (BASF)" and the file has "Allantoina". A smart-key collision
  // (>1 entries) means we don't know which to target, so we leave the lookup
  // empty and let the user resolve manually via a warning.
  const rawBySmartKey = new Map<string, RawMaterial[]>();
  for (const rm of allRaw) {
    const k = smartNormalize(rm.name);
    if (!k) continue;
    const arr = rawBySmartKey.get(k) ?? [];
    arr.push(rm);
    rawBySmartKey.set(k, arr);
  }

  // In "overwrite" mode the file is the full source of truth for raw
  // materials: drop entries that don't appear in the file. Suppliers are
  // treated as a catalog and kept either way (mirrors how recipe import keeps
  // its raw/component catalog).
  if (mode === 'overwrite') {
    const incomingNames = new Set(parsed.map((p) => normalizeKey(p.name)));
    // Catalog entries reached only via an alias or smart-key match from the
    // file must also be kept alive — otherwise we'd delete "Spirualit" just
    // because the file spells it "Spirual" (or delete "Allantoina (BASF)"
    // when the file says "Allantoina").
    const aliasKeptIds = new Set<string>();
    for (const p of parsed) {
      const tid = aliasMap.get(smartNormalize(p.name));
      if (tid) aliasKeptIds.add(tid);
      const smartHits = rawBySmartKey.get(smartNormalize(p.name)) ?? [];
      if (smartHits.length === 1) aliasKeptIds.add(smartHits[0].id);
    }
    for (const rm of allRaw) {
      if (incomingNames.has(normalizeKey(rm.name))) continue;
      if (aliasKeptIds.has(rm.id)) continue;
      const res = await db.deleteRawMaterial(rm.id);
      if (res.ok) {
        rawByKey.delete(normalizeKey(rm.name));
        rawById.delete(rm.id);
        const smartKey = smartNormalize(rm.name);
        if (smartKey) {
          const arr = rawBySmartKey.get(smartKey)?.filter((x) => x.id !== rm.id) ?? [];
          if (arr.length === 0) rawBySmartKey.delete(smartKey);
          else rawBySmartKey.set(smartKey, arr);
        }
        summary.rawDeleted++;
      } else {
        summary.warnings.push(
          `Nie usunięto surowca "${rm.name}" — używany przez: ${(res.blockedBy ?? []).join(', ') || 'nieznane miejsca'}.`,
        );
      }
    }
  }

  // Suggestion pool reused for fuzzy-duplicate detection on creates. Includes
  // each catalog entry plus the aliases that point to it, so a new row that
  // smells like an already-known alias gets flagged too.
  const aliasesByTarget = new Map<string, string[]>();
  for (const a of aliases) {
    const arr = aliasesByTarget.get(a.targetId) ?? [];
    arr.push(a.alias);
    aliasesByTarget.set(a.targetId, arr);
  }
  const suggestionCandidates = () =>
    Array.from(rawById.values()).map((rm) => ({
      id: rm.id,
      name: rm.name,
      aliases: aliasesByTarget.get(rm.id),
    }));

  for (const row of parsed) {
    const supplier = supplierByKey.get(normalizeKey(row.supplierName));
    if (!supplier) {
      summary.warnings.push(
        `Wewnętrzny błąd: dostawca "${row.supplierName}" nie został upsertowany — pomijam "${row.name}".`,
      );
      summary.rawSkipped++;
      continue;
    }

    // Lookup order: exact name → alias → smart-normalized unique match → null
    // (create new). The smart-key step lets "Allantoina" in the file match an
    // existing "Allantoina (BASF)" in the catalog, but only when the smart key
    // points unambiguously to a single catalog entry. Aliases come before
    // smart-key because they're an explicit user decision and must always win.
    let existing = rawByKey.get(normalizeKey(row.name));
    if (!existing) {
      const aliasTargetId = aliasMap.get(smartNormalize(row.name));
      if (aliasTargetId) existing = rawById.get(aliasTargetId);
    }
    if (!existing) {
      const smartHits = rawBySmartKey.get(smartNormalize(row.name)) ?? [];
      if (smartHits.length === 1) {
        existing = smartHits[0];
      } else if (smartHits.length > 1) {
        summary.warnings.push(
          `Niejednoznaczne dopasowanie dla "${row.name}" — kilka istniejących pozycji ma tę samą nazwę po usunięciu sufiksów: ${smartHits.map((x) => `"${x.name}"`).join(', ')}. Utworzyłem nowy wpis.`,
        );
      }
    }
    const packageNote = row.packageSizeRaw
      ? `Wielkość opakowania: ${row.packageSizeRaw} kg`
      : undefined;

    if (existing) {
      let patch: Partial<RawMaterial>;
      if (mode === 'merge') {
        // Conservative merge — preserve manually edited values, but always
        // refresh the "freshest from file" fields (price/currency/moq/preferred
        // supplier).
        const supplierIds = existing.supplierIds.includes(supplier.id)
          ? existing.supplierIds
          : [...existing.supplierIds, supplier.id];
        patch = {
          supplierIds,
          preferredSupplierId: supplier.id,
          notes: mergeNotes(existing.notes, packageNote),
        };
        if (row.purchaseNet !== undefined && row.purchaseNet > 0) {
          patch.lastPurchasePriceNet = row.purchaseNet;
        }
        if (row.currency) patch.currency = row.currency;
        if (row.packageSizeKg !== undefined && row.packageSizeKg > 0) {
          patch.moq = row.packageSizeKg;
        }
      } else {
        // Overwrite — file wins for every field the file can express. Catalog-
        // only fields the file doesn't carry (unit, factorySupplied,
        // leadTimeDays, shelfLifeMonths, mpFirmaSymbol) are preserved.
        patch = {
          supplierIds: [supplier.id],
          preferredSupplierId: supplier.id,
          notes: packageNote,
          lastPurchasePriceNet:
            row.purchaseNet !== undefined && row.purchaseNet > 0 ? row.purchaseNet : undefined,
          currency: row.currency,
          moq:
            row.packageSizeKg !== undefined && row.packageSizeKg > 0
              ? row.packageSizeKg
              : undefined,
        };
      }
      // Suppress no-op writes. The matched-but-unchanged case is common when
      // the file is re-imported without edits — bumping the counter every time
      // would mislead the user into thinking real changes happened.
      if (!rawPatchHasChanges(existing, patch)) {
        // existing maps already point at the right entry; nothing to refresh.
        continue;
      }
      const updated = await db.updateRawMaterial(existing.id, patch);
      rawByKey.set(normalizeKey(updated.name), updated);
      rawById.set(updated.id, updated);
      const smartKey = smartNormalize(updated.name);
      if (smartKey) {
        const arr = rawBySmartKey.get(smartKey) ?? [];
        const without = arr.filter((x) => x.id !== updated.id);
        without.push(updated);
        rawBySmartKey.set(smartKey, without);
      }
      summary.rawUpdated++;
    } else {
      // Before creating, check if any existing catalog entry looks suspiciously
      // similar — this catches probable duplicates the user can clean up later
      // by adding an alias in Stock Import.
      const candidates = suggestionCandidates();
      const topMatch = suggestMatches({ name: row.name }, candidates, {
        limit: 1,
        threshold: 0.85,
      })[0];
      if (topMatch) {
        summary.warnings.push(
          `Możliwy duplikat: "${row.name}" wygląda jak istniejący "${topMatch.name}" (${Math.round(topMatch.confidence * 100)}%). Jeśli to ta sama pozycja, dodaj alias przy następnym imporcie magazynu.`,
        );
      }

      const created = await db.createRawMaterial({
        name: row.name,
        unit: 'kg' as Unit,
        supplierIds: [supplier.id],
        preferredSupplierId: supplier.id,
        factorySupplied: false,
        moq:
          row.packageSizeKg !== undefined && row.packageSizeKg > 0
            ? row.packageSizeKg
            : undefined,
        lastPurchasePriceNet:
          row.purchaseNet !== undefined && row.purchaseNet > 0 ? row.purchaseNet : undefined,
        currency: row.currency,
        notes: packageNote,
      });
      rawByKey.set(normalizeKey(created.name), created);
      rawById.set(created.id, created);
      const smartKey = smartNormalize(created.name);
      if (smartKey) {
        const arr = rawBySmartKey.get(smartKey) ?? [];
        arr.push(created);
        rawBySmartKey.set(smartKey, arr);
      }
      summary.rawCreated++;
    }
  }

  log.info(
    `[raw-materials-import] ${path.basename(filePath)} (${mode}): +${summary.rawCreated} ~${summary.rawUpdated} -${summary.rawDeleted} raw, +${summary.suppliersCreated} ~${summary.suppliersUpdated} suppliers, ${summary.warnings.length} warnings`,
  );

  return summary;
}
