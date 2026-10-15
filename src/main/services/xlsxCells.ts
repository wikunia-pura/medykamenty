// Shared cell readers for the exceljs-based importers. Every importer used to
// carry its own asString / asNumber copy and they had drifted apart (one only
// understood `{ text }`, so formula and rich-text names were silently skipped;
// none understood "1.234,56"). Keep the one implementation here.
//
// exceljs hands a cell value back as one of:
//   string | number | boolean | Date | null
//   { richText: [{ text }] }              rich-formatted text
//   { text, hyperlink }                   hyperlink cell (text = label)
//   { formula | sharedFormula, result }   formula; result may be any of the
//                                         above, or { error: '#N/A' }
//   { error: '#DIV/0!' }                  error cell

// Excel stores dates without a time zone; exceljs turns the serial into a Date
// at UTC midnight of that wall-clock day. The UTC getters therefore give back
// the date as written in the sheet, in any machine time zone.
export function excelDateIso(d: Date): string | undefined {
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Cell → trimmed text, or undefined when empty. Rich text is joined, a
 * hyperlink yields its label (falling back to the URL), a formula its cached
 * result, a date its YYYY-MM-DD. Trailing "<" / ">" left behind by broken
 * spreadsheet edits are stripped.
 */
export function asString(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const t = v.trim().replace(/[<>]+$/, '').trim();
    return t.length === 0 ? undefined : t;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : undefined;
  if (typeof v === 'boolean') return undefined;
  if (v instanceof Date) return excelDateIso(v);
  if (typeof v === 'object') {
    if ('error' in v) return undefined;
    if ('richText' in v) {
      const parts = (v as { richText?: { text?: string }[] }).richText ?? [];
      return asString(parts.map((p) => p?.text ?? '').join(''));
    }
    // `text` before `hyperlink`: a hyperlink cell carries both, and the label
    // is what the user sees (the URL is only a fallback).
    if ('text' in v) {
      const text = asString((v as { text: unknown }).text);
      if (text !== undefined) return text;
    }
    if ('result' in v) return asString((v as { result: unknown }).result);
    if ('hyperlink' in v) return asString((v as { hyperlink: unknown }).hyperlink);
  }
  return undefined;
}

// Leading number of a text cell, Polish formats included. Whitespace (also
// NBSP / thin space used as a thousands separator) is dropped first, then:
//   * a comma present → it is the decimal mark and dots are thousands:
//     "1 234,56", "1.234,56", "1234,56" → 1234.56
//   * no comma → a dot is the decimal mark: "1.5" → 1.5, except a dot-grouped
//     integer with 2+ groups ("1.234.567") which can only be thousands.
// Text after the number is ignored ("100 ml" → 100, "5%" → 5), matching the
// parseFloat behaviour the importers were written against.
function parseNumberText(raw: string): number | undefined {
  const s = raw.replace(/[\s   ]/g, '');
  const m = /^[-+]?[\d.,]*\d/.exec(s);
  if (!m) return undefined;
  let num = m[0];
  if (num.includes(',')) {
    // "1,234.56" (English grouping) — comma before the last dot.
    if (num.includes('.') && num.lastIndexOf('.') > num.lastIndexOf(',')) {
      num = num.replace(/,/g, '');
    } else {
      const lastComma = num.lastIndexOf(',');
      num = num.slice(0, lastComma).replace(/[.,]/g, '') + '.' + num.slice(lastComma + 1);
    }
  } else if (/^[-+]?\d{1,3}(\.\d{3}){2,}$/.test(num)) {
    num = num.replace(/\./g, '');
  } else {
    // Keep only the first decimal point ("1.2.3" → "1.2").
    const firstDot = num.indexOf('.');
    if (firstDot !== -1) num = num.slice(0, firstDot + 1) + num.slice(firstDot + 1).split('.')[0];
  }
  const n = Number(num);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Cell → finite number, or undefined. Numbers pass through (NaN / ±Infinity
 * rejected), formulas yield their cached result, text is parsed with Polish
 * separators (see parseNumberText). Dates and booleans are not numbers.
 */
export function asNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') return parseNumberText(v);
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('error' in v) return undefined;
    if ('result' in v) return asNumber((v as { result: unknown }).result);
    if ('richText' in v || 'text' in v) {
      const s = asString(v);
      return s === undefined ? undefined : parseNumberText(s);
    }
  }
  return undefined;
}

// Cells that carry a placeholder ("-", "—", "Nieznane", "brak") should be
// treated as empty. Used for every supplementary field (contact, lead time,
// supplier name, …) so we don't persist junk like a "Nieznany" supplier.
const PLACEHOLDERS = new Set(['-', '–', '—', 'nieznane', 'nieznany', 'brak', 'b/d', 'n/d']);

/** asString, with placeholder values ("-", "Nieznany", "brak", …) as undefined. */
export function cleanCell(v: unknown): string | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  return PLACEHOLDERS.has(s.trim().toLowerCase()) ? undefined : s;
}
