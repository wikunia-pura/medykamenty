// Import the "Plik z komponentami.xlsx" file — the buyer's source of truth for
// every packaging component the company buys: which supplier, contact person,
// order quantity, lead time, payment terms, ordering notes. One row = one
// component with at most one supplier; many components share suppliers, so the
// importer runs in two passes:
//   1. Upsert every unique supplier mentioned in the file
//   2. Upsert every component and link it to its supplier
//
// Differences from the raw-materials importer (xlsxRawMaterialsImporter.ts):
//   * The file carries no price column, so lastPurchasePriceNet/currency are
//     never touched.
//   * "Ilość" (order quantity, e.g. "5000", "od 1000") maps to moq. A leading
//     "od" prefix is dropped; values that don't parse to a number are kept as
//     a component note instead.
//   * "Czas oczekiwania" is free text ("6-8 tygodni", "kilka dni"). We try to
//     turn it into leadTimeDays (weeks → days); when it can't be parsed it is
//     appended to the component notes.
//   * "Warunki płatności" + "Termin płatności" are combined into the supplier's
//     paymentTerms (e.g. "Faktura, 7 dni").
//   * The file has no component type column, so the type is inferred from the
//     name (Tuba → tube, Etykieta → label, Karton zbiorczy → outer_carton, …).
//     The inferred type is only applied when creating a component; an existing
//     component keeps its (possibly hand-corrected) type.
//   * Rows whose supplier is a placeholder ("Nieznany", "-") are still imported
//     as components — just without a supplier link (unlike raw materials, which
//     skip supplier-less rows).
//
// Merge strategy mirrors the raw importer: match by case-insensitive trimmed
// name, preserve manually edited fields, always refresh moq / leadTime /
// preferred supplier. Overwrite mode treats the file as the full component
// catalog and deletes entries missing from it.

import ExcelJS from 'exceljs';
import path from 'path';
import type Database from '../database';
import type {
  PackagingComponent,
  ComponentType,
  ComponentsImportSummary,
  RawMaterialsImportMode,
  Supplier,
} from '../../shared/types';
import log from '../utils/logger';
import { normalize as smartNormalize, suggestMatches } from './smartMatcher';

interface ColumnMap {
  name: number;
  supplier?: number;
  contactPerson?: number;
  email?: number;
  phone?: number;
  quantity?: number; // Ilość → moq
  leadTime?: number; // Czas oczekiwania
  paymentTerms?: number; // Warunki płatności
  paymentDeadline?: number; // Termin płatności
  notes?: number; // Uwagi
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
      const cleaned = joined.replace(/[<>]+$/, '').trim();
      return cleaned.length === 0 ? undefined : cleaned;
    }
    if ('result' in v) return asString((v as { result: unknown }).result);
    if ('hyperlink' in v) return asString((v as { hyperlink: unknown }).hyperlink);
  }
  return undefined;
}

// Cells that carry a placeholder ("-", "—", "Nieznane", "brak") should be
// treated as empty. Used for every supplementary field (contact, lead time,
// supplier name, …) so we don't persist junk like a "Nieznany" supplier.
const PLACEHOLDERS = new Set(['-', '–', '—', 'nieznane', 'nieznany', 'brak', 'b/d', 'n/d']);
function cleanCell(v: unknown): string | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  return PLACEHOLDERS.has(s.trim().toLowerCase()) ? undefined : s;
}

// Parse an "Ilość" cell into a numeric MOQ. Handles a leading "od " (minimum)
// prefix and stray thousands separators. Returns undefined for ranges or other
// non-numeric values (kept as a note by the caller).
function parseQuantity(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^\s*od\s+/i, '').replace(/\s/g, '').replace(',', '.');
  // A range like "1000-2000" is ambiguous as a single MOQ — leave it as text.
  if (/\d[\s,.\d]*-\s*\d/.test(raw)) return undefined;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// Best-effort parse of free-text lead time ("6-8 tygodni", "2 tygodnie",
// "kilka dni") into a number of days. Ranges resolve to the upper bound (more
// conservative for planning). Returns undefined when no number is present.
function parseLeadTimeDays(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  const nums = (lower.match(/\d+(?:[.,]\d+)?/g) ?? []).map((s) => parseFloat(s.replace(',', '.')));
  if (nums.length === 0) return undefined;
  const value = Math.max(...nums);
  let mult = 1;
  if (/tyg/.test(lower)) mult = 7;
  else if (/mies/.test(lower)) mult = 30;
  // "dni"/"dzień" or no unit → treat the number as days.
  const days = Math.round(value * mult);
  return Number.isFinite(days) && days > 0 ? days : undefined;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------- type inference ----------
//
// The components file has no type column. Map the leading words of the name to
// a ComponentType. Order matters: the first matching rule wins.
function inferComponentType(name: string): ComponentType {
  const n = normalizeKey(name);
  if (n.startsWith('atomizer') || n.startsWith('dozownik')) return 'pump';
  if (n.startsWith('beczka')) return 'barrel';
  if (n.startsWith('butelka')) return 'bottle';
  if (n.startsWith('sloik') || n.startsWith('słoik') || n.startsWith('sĹ‚oik')) return 'jar';
  if (n.startsWith('etykieta')) return 'label';
  if (n.startsWith('karton zbiorczy')) return 'outer_carton';
  if (n.startsWith('kartonik')) return 'box';
  if (
    n.startsWith('nakretka') ||
    n.startsWith('nakrętka') ||
    n.startsWith('zakretka') ||
    n.startsWith('zakrętka') ||
    n.startsWith('zamkniecie') ||
    n.startsWith('zamknięcie') ||
    n.includes('kaniula')
  )
    return 'cap';
  if (n.startsWith('pipet')) return 'pipette';
  if (n.startsWith('tasma') || n.startsWith('taśma')) return 'tape';
  if (n.startsWith('tuba')) return 'tube';
  if (n.startsWith('ulotka')) return 'leaflet';
  if (n.startsWith('worek')) return 'bag';
  return 'other';
}

// ---------- header detection ----------

function detectColumns(headerRow: ExcelJS.Row): ColumnMap | null {
  const map: Partial<ColumnMap> = {};
  headerRow.eachCell((cell, col) => {
    const raw = asString(cell.value) ?? '';
    const lower = raw.toLowerCase();
    if (lower.startsWith('nazwa komponentu') || lower === 'nazwa' || lower === 'name')
      map.name = col;
    else if (lower === 'dostawca' || lower === 'supplier') map.supplier = col;
    else if (lower.startsWith('osoba kontaktowa') || lower === 'contact person')
      map.contactPerson = col;
    else if (lower === 'mail' || lower === 'e-mail' || lower === 'email') map.email = col;
    else if (lower.startsWith('nr telefonu') || lower === 'telefon' || lower === 'phone')
      map.phone = col;
    else if (lower.startsWith('ilość') || lower.startsWith('ilosc') || lower === 'moq')
      map.quantity = col;
    else if (lower.startsWith('czas oczekiwania') || lower.startsWith('lead'))
      map.leadTime = col;
    // "Termin płatności" must be checked before "Warunki płatności" since both
    // could loosely match a "płatnoś" substring otherwise.
    else if (lower.startsWith('termin płatności') || lower.startsWith('termin platnosci'))
      map.paymentDeadline = col;
    else if (lower.startsWith('warunki płatności') || lower.startsWith('warunki platnosci'))
      map.paymentTerms = col;
    else if (lower === 'uwagi' || lower === 'notes') map.notes = col;
  });
  if (!map.name) return null;
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

// Compare a Partial<PackagingComponent> patch to the current entity, ignoring
// supplierIds order. Suppresses no-op updates so the summary doesn't claim
// "X komponentów zaktualizowanych" on a re-import with no real changes.
function componentPatchHasChanges(
  existing: PackagingComponent,
  patch: Partial<PackagingComponent>,
): boolean {
  for (const [key, value] of Object.entries(patch) as [keyof PackagingComponent, unknown][]) {
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

// Combine "Warunki płatności" and "Termin płatności" into one payment-terms
// string (e.g. "Faktura, 7 dni").
function combinePaymentTerms(
  terms: string | undefined,
  deadline: string | undefined,
): string | undefined {
  const parts = [terms, deadline].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

// ---------- main entry point ----------

export async function importComponentsXlsx(
  filePath: string,
  mode: RawMaterialsImportMode,
  db: Database,
): Promise<ComponentsImportSummary> {
  const summary: ComponentsImportSummary = {
    mode,
    componentsCreated: 0,
    componentsUpdated: 0,
    componentsSkipped: 0,
    componentsDeleted: 0,
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
    throw new Error(`Nie rozpoznano nagłówków pliku. Wymagana kolumna: "Nazwa komponentu".`);
  }
  const { row: headerRow, columns } = header;

  // ---------- collect rows ----------
  interface ParsedRow {
    name: string;
    supplierName?: string;
    contactPerson?: string;
    email?: string;
    phone?: string;
    paymentTerms?: string;
    supplierNotes?: string;
    moq?: number;
    quantityRaw?: string;
    leadTimeDays?: number;
    leadTimeRaw?: string;
  }

  const parsed: ParsedRow[] = [];
  for (let i = headerRow.number + 1; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const name = asString(r.getCell(columns.name).value);
    if (!name) continue;

    const quantityRaw = columns.quantity ? cleanCell(r.getCell(columns.quantity).value) : undefined;
    const moq = parseQuantity(quantityRaw);
    const leadTimeRaw = columns.leadTime ? cleanCell(r.getCell(columns.leadTime).value) : undefined;
    const leadTimeDays = parseLeadTimeDays(leadTimeRaw);

    parsed.push({
      name,
      supplierName: columns.supplier ? cleanCell(r.getCell(columns.supplier).value) : undefined,
      contactPerson: columns.contactPerson
        ? cleanCell(r.getCell(columns.contactPerson).value)
        : undefined,
      email: columns.email ? cleanCell(r.getCell(columns.email).value) : undefined,
      phone: columns.phone ? cleanCell(r.getCell(columns.phone).value) : undefined,
      paymentTerms: combinePaymentTerms(
        columns.paymentTerms ? cleanCell(r.getCell(columns.paymentTerms).value) : undefined,
        columns.paymentDeadline ? cleanCell(r.getCell(columns.paymentDeadline).value) : undefined,
      ),
      supplierNotes: columns.notes ? cleanCell(r.getCell(columns.notes).value) : undefined,
      moq,
      // Keep raw text only when it wouldn't round-trip to the numeric moq.
      quantityRaw: moq === undefined ? quantityRaw : undefined,
      leadTimeDays,
      leadTimeRaw: leadTimeDays === undefined ? leadTimeRaw : undefined,
    });
  }

  // ---------- pass 1: suppliers ----------
  const allSuppliers = await db.listSuppliers();
  const supplierByKey = new Map<string, Supplier>();
  for (const s of allSuppliers) supplierByKey.set(normalizeKey(s.name), s);

  // Aggregate per-supplier data from the file (first non-empty scalar wins,
  // notes merged). Rows without a (real) supplier are skipped here.
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
    if (!row.supplierName) continue;
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
        // New suppliers from the components file are component suppliers, so
        // they show up in the component supplier picker (which hides 'raw').
        type: 'component',
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

  // ---------- pass 2: components ----------
  const allComponents = await db.listComponents();
  const compByKey = new Map<string, PackagingComponent>();
  for (const c of allComponents) compByKey.set(normalizeKey(c.name), c);

  // Aliases learned from stock import: incoming names mapped to an existing
  // component target that catalog entry instead of creating a duplicate.
  const aliases = await db.listComponentAliases();
  const aliasMap = new Map<string, string>();
  for (const a of aliases) aliasMap.set(smartNormalize(a.alias), a.targetId);
  const compById = new Map<string, PackagingComponent>();
  for (const c of allComponents) compById.set(c.id, c);

  // Smart-normalized index for fuzzy fallback matching (diacritics stripped,
  // parenthetical suffixes dropped). Only a unique hit is trusted.
  const compBySmartKey = new Map<string, PackagingComponent[]>();
  for (const c of allComponents) {
    const k = smartNormalize(c.name);
    if (!k) continue;
    const arr = compBySmartKey.get(k) ?? [];
    arr.push(c);
    compBySmartKey.set(k, arr);
  }

  // In "overwrite" mode the file is the full source of truth for components:
  // drop entries that don't appear in the file (kept alive when reached via an
  // alias or unique smart-key match). Suppliers are kept either way.
  if (mode === 'overwrite') {
    const incomingNames = new Set(parsed.map((p) => normalizeKey(p.name)));
    const aliasKeptIds = new Set<string>();
    for (const p of parsed) {
      const tid = aliasMap.get(smartNormalize(p.name));
      if (tid) aliasKeptIds.add(tid);
      const smartHits = compBySmartKey.get(smartNormalize(p.name)) ?? [];
      if (smartHits.length === 1) aliasKeptIds.add(smartHits[0].id);
    }
    for (const c of allComponents) {
      if (incomingNames.has(normalizeKey(c.name))) continue;
      if (aliasKeptIds.has(c.id)) continue;
      const res = await db.deleteComponent(c.id);
      if (res.ok) {
        compByKey.delete(normalizeKey(c.name));
        compById.delete(c.id);
        const smartKey = smartNormalize(c.name);
        if (smartKey) {
          const arr = compBySmartKey.get(smartKey)?.filter((x) => x.id !== c.id) ?? [];
          if (arr.length === 0) compBySmartKey.delete(smartKey);
          else compBySmartKey.set(smartKey, arr);
        }
        summary.componentsDeleted++;
      } else {
        summary.warnings.push(
          `Nie usunięto komponentu "${c.name}" — używany przez: ${(res.blockedBy ?? []).join(', ') || 'nieznane miejsca'}.`,
        );
      }
    }
  }

  // Suggestion pool for fuzzy-duplicate detection on creates.
  const aliasesByTarget = new Map<string, string[]>();
  for (const a of aliases) {
    const arr = aliasesByTarget.get(a.targetId) ?? [];
    arr.push(a.alias);
    aliasesByTarget.set(a.targetId, arr);
  }
  const suggestionCandidates = () =>
    Array.from(compById.values()).map((c) => ({
      id: c.id,
      name: c.name,
      aliases: aliasesByTarget.get(c.id),
    }));

  for (const row of parsed) {
    const supplier = row.supplierName
      ? supplierByKey.get(normalizeKey(row.supplierName))
      : undefined;

    // Build the note suffixes that hold values the file couldn't structure
    // (a quantity range, an unparseable lead time).
    const noteParts: string[] = [];
    if (row.quantityRaw) noteParts.push(`Ilość: ${row.quantityRaw}`);
    if (row.leadTimeRaw) noteParts.push(`Czas oczekiwania: ${row.leadTimeRaw}`);
    const extraNote = noteParts.length > 0 ? noteParts.join('\n') : undefined;

    // Lookup order: exact name → alias → unique smart-normalized match → create.
    let existing = compByKey.get(normalizeKey(row.name));
    if (!existing) {
      const aliasTargetId = aliasMap.get(smartNormalize(row.name));
      if (aliasTargetId) existing = compById.get(aliasTargetId);
    }
    if (!existing) {
      const smartHits = compBySmartKey.get(smartNormalize(row.name)) ?? [];
      if (smartHits.length === 1) {
        existing = smartHits[0];
      } else if (smartHits.length > 1) {
        summary.warnings.push(
          `Niejednoznaczne dopasowanie dla "${row.name}" — kilka istniejących pozycji ma tę samą nazwę po usunięciu sufiksów: ${smartHits.map((x) => `"${x.name}"`).join(', ')}. Utworzyłem nowy wpis.`,
        );
      }
    }

    if (existing) {
      let patch: Partial<PackagingComponent>;
      if (mode === 'merge') {
        // Conservative: preserve manual fields, refresh moq / leadTime /
        // preferred supplier from the file. The component type is left intact.
        const supplierIds =
          supplier && !existing.supplierIds.includes(supplier.id)
            ? [...existing.supplierIds, supplier.id]
            : existing.supplierIds;
        patch = {
          supplierIds,
          notes: mergeNotes(existing.notes, extraNote),
        };
        if (supplier) patch.preferredSupplierId = supplier.id;
        if (row.moq !== undefined) patch.moq = row.moq;
        if (row.leadTimeDays !== undefined) patch.leadTimeDays = row.leadTimeDays;
      } else {
        // Overwrite — file wins for the fields it can express. Catalog-only
        // fields the file doesn't carry (type, mpFirmaSymbol, price, currency,
        // capacity, dependencies) are preserved.
        patch = {
          supplierIds: supplier ? [supplier.id] : [],
          preferredSupplierId: supplier ? supplier.id : undefined,
          notes: extraNote,
          moq: row.moq,
          leadTimeDays: row.leadTimeDays,
        };
      }
      if (!componentPatchHasChanges(existing, patch)) continue;
      const updated = await db.updateComponent(existing.id, patch);
      compByKey.set(normalizeKey(updated.name), updated);
      compById.set(updated.id, updated);
      const smartKey = smartNormalize(updated.name);
      if (smartKey) {
        const arr = compBySmartKey.get(smartKey) ?? [];
        const without = arr.filter((x) => x.id !== updated.id);
        without.push(updated);
        compBySmartKey.set(smartKey, without);
      }
      summary.componentsUpdated++;
    } else {
      // Flag probable duplicates so the user can add an alias later.
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

      const type = inferComponentType(row.name);
      if (type === 'other') {
        summary.warnings.push(
          `Nie rozpoznano typu komponentu "${row.name}" — ustawiono "other". Popraw go ręcznie w razie potrzeby.`,
        );
      }

      const created = await db.createComponent({
        name: row.name,
        type,
        supplierIds: supplier ? [supplier.id] : [],
        preferredSupplierId: supplier ? supplier.id : undefined,
        moq: row.moq,
        leadTimeDays: row.leadTimeDays,
        notes: extraNote,
      });
      compByKey.set(normalizeKey(created.name), created);
      compById.set(created.id, created);
      const smartKey = smartNormalize(created.name);
      if (smartKey) {
        const arr = compBySmartKey.get(smartKey) ?? [];
        arr.push(created);
        compBySmartKey.set(smartKey, arr);
      }
      summary.componentsCreated++;
    }
  }

  log.info(
    `[components-import] ${path.basename(filePath)} (${mode}): +${summary.componentsCreated} ~${summary.componentsUpdated} -${summary.componentsDeleted} components, +${summary.suppliersCreated} ~${summary.suppliersUpdated} suppliers, ${summary.warnings.length} warnings`,
  );

  return summary;
}
