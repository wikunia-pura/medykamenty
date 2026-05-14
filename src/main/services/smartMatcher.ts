// Smart fuzzy matcher used to suggest existing raw materials / components for
// unrecognized stock import rows. Heuristics target the noise patterns we see
// in MP Firma exports vs. our catalog names: Polish diacritics, parenthetical
// notes like "(99%)", suffixes such as "spray suszony" / "ekstrakt", trailing
// manufacturer codes, % signs, units (kg, g, ml, l).
//
// The score is the maximum of:
//   * Levenshtein-similarity on the aggressively normalized strings
//   * Token-set Jaccard (tokens reordered, missing tokens punished)
// Both range [0,1]; taking the max lets either signal carry a match.

export interface SuggestionCandidate {
  id: string;
  name: string;
  /**
   * Extra search keys (e.g. stored aliases). Treated as alternative names —
   * if any of them scores higher than `name`, that score wins.
   */
  aliases?: string[];
  mpFirmaSymbol?: string;
}

export interface Suggestion {
  id: string;
  name: string;
  confidence: number;
}

const DIACRITICS = /[̀-ͯ]/g;
// Parenthetical chunks (), [], {} are usually descriptive noise.
const PAREN_NOISE = /[([{][^)\]}]*[)\]}]/g;
// Unit-ish tokens commonly appended to MP Firma rows.
const UNIT_TOKENS = /\b(kg|g|gram|gramy|ml|l|szt|sztuk|szt\.|opak|opakowanie|%)\b/g;
// Common product-form noise words (Polish + English) — stripped before scoring.
const FORM_NOISE = new Set([
  'spray',
  'suszony',
  'suszona',
  'suszone',
  'ekstrakt',
  'extract',
  'proszek',
  'powder',
  'liofilizowany',
  'liofilizowana',
  'liofilizowane',
  'olej',
  'oil',
  'mielony',
  'mielona',
  'mielone',
  'organic',
  'organiczny',
  'organiczna',
  'bio',
  'naturalny',
  'naturalna',
]);
const PUNCT = /[.,;:!?_\-/\\+*'"`]/g;
// Invisible characters that can sneak in via copy-paste (ZWSP, ZWNJ, ZWJ,
// word joiner, BOM, soft hyphen). Stripped up front so they don't survive
// into tokens or break equality on aggressively normalized strings.
const INVISIBLE_CHARS = /[​-‍⁠﻿­]/gu;

export function normalize(s: string): string {
  if (!s) return '';
  return s
    .replace(INVISIBLE_CHARS, '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(PAREN_NOISE, ' ')
    .replace(/&/g, ' ')
    .replace(PUNCT, ' ')
    .replace(UNIT_TOKENS, ' ')
    .replace(/\d+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  return normalized
    .split(' ')
    .filter((t) => t.length >= 2 && !FORM_NOISE.has(t));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function levenshteinSimilarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function tokenJaccard(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 && bTokens.length === 0) return 1;
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Prefix bonus: many real-world variants share a long common prefix
// ("Spirual" vs "Spirualit", "Lactobacillus" vs "Lactobacillus acidophilus").
function prefixBonus(a: string, b: string): number {
  const min = Math.min(a.length, b.length);
  if (min === 0) return 0;
  let i = 0;
  while (i < min && a[i] === b[i]) i++;
  if (i < 3) return 0;
  return Math.min(0.15, (i / Math.max(a.length, b.length)) * 0.2);
}

function scoreOne(sourceNorm: string, sourceTokens: string[], candidateName: string): number {
  const candNorm = normalize(candidateName);
  const candTokens = tokenize(candNorm);
  const lev = levenshteinSimilarity(sourceNorm, candNorm);
  const jac = tokenJaccard(sourceTokens, candTokens);
  const base = Math.max(lev, jac);
  return Math.min(1, base + prefixBonus(sourceNorm, candNorm));
}

/**
 * Return up to `limit` candidates ranked by score >= threshold.
 * Exact-symbol matches always rank first with confidence 1.
 */
export function suggestMatches(
  source: { name: string; mpFirmaSymbol?: string },
  candidates: SuggestionCandidate[],
  opts: { limit?: number; threshold?: number } = {},
): Suggestion[] {
  const limit = opts.limit ?? 3;
  const threshold = opts.threshold ?? 0.55;
  if (candidates.length === 0) return [];

  const out: Suggestion[] = [];

  if (source.mpFirmaSymbol) {
    for (const c of candidates) {
      if (c.mpFirmaSymbol && c.mpFirmaSymbol === source.mpFirmaSymbol) {
        out.push({ id: c.id, name: c.name, confidence: 1 });
      }
    }
  }

  const sourceNorm = normalize(source.name);
  const sourceTokens = tokenize(sourceNorm);

  for (const c of candidates) {
    if (out.some((s) => s.id === c.id)) continue;
    let best = scoreOne(sourceNorm, sourceTokens, c.name);
    for (const alias of c.aliases ?? []) {
      const s = scoreOne(sourceNorm, sourceTokens, alias);
      if (s > best) best = s;
    }
    if (best >= threshold) {
      out.push({ id: c.id, name: c.name, confidence: best });
    }
  }

  return out
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
