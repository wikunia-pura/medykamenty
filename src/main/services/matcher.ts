import { FUZZY_MATCH_THRESHOLD } from '../../shared/constants';

interface Candidate {
  id: string;
  name: string;
  mpFirmaSymbol?: string;
}

export interface MatchResult {
  id?: string;
  confidence: number;
  ambiguous: boolean;
  alternatives?: { id: string; confidence: number }[];
}

// Strip invisible characters (zero-width space, ZWNJ, ZWJ, word joiner, BOM,
// soft hyphen) before trim/lowercase/whitespace-collapse so two names that
// look identical can't have different bytes. Kept in sync with the recipe
// importer's `normalize` so both flows match the same way.
const INVISIBLE_CHARS = /[​-‍⁠﻿­]/gu;

function normalize(s: string): string {
  return s
    .replace(INVISIBLE_CHARS, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// Levenshtein distance — for short strings (≤ ~100 chars) this is fast enough
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

function similarity(a: string, b: string): number {
  const aN = normalize(a);
  const bN = normalize(b);
  if (!aN.length && !bN.length) return 1;
  const maxLen = Math.max(aN.length, bN.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(aN, bN);
  return 1 - dist / maxLen;
}

// Split a name into comparable tokens. Folds diacritics (incl. Polish ł, which
// NFD does not decompose) and lowercases, so "Ł"→"l" and "biała"→"biala".
function variantTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/[^\p{L}\d]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// Is every token of `from` explained by some token of `to`?
//   * a number ("100", "10") must appear verbatim — 100 is never a typo of 200,
//     nor 1 of 10;
//   * a short code (≤2 chars, e.g. line letter "p"/"l") must appear verbatim;
//   * a longer word may match a near-twin (typo / inflection / diacritics) or be
//     absorbed by a join/split spelling ("tego"+"care" ⇄ "tegocare").
// Any leftover token means the two names denote *different* variants.
function tokensCovered(from: string[], to: string[]): boolean {
  const joined = to.join('');
  return from.every((t) => {
    if (/^\d+$/.test(t) || t.length <= 2) return to.includes(t);
    if (to.some((u) => u.length > 2 && similarity(t, u) >= 0.7)) return true;
    // join/split tolerance: "tegocare" vs "tego care"
    return joined.includes(t) || t.includes(joined);
  });
}

// Two names are the *same variant* only when neither carries a distinguishing
// token the other lacks. Fully generic — no colour/keyword list: any extra word
// ("biały" vs "brylantowy"), differing number, or differing line-code is enough
// to keep them apart, so a high Levenshtein score can't merge distinct items
// (e.g. "Butelka 100 ml" ✗ "Butelka 200 ml", "Cutis P" ✗ "Cutis Ł").
function sameVariant(a: string, b: string): boolean {
  const ta = variantTokens(a);
  const tb = variantTokens(b);
  return tokensCovered(ta, tb) && tokensCovered(tb, ta);
}

export function matchOne(
  source: { name: string; mpFirmaSymbol?: string },
  candidates: Candidate[],
): MatchResult {
  if (candidates.length === 0) return { confidence: 0, ambiguous: false };

  if (source.mpFirmaSymbol) {
    const symbolMatches = candidates.filter(
      (c) => c.mpFirmaSymbol && c.mpFirmaSymbol === source.mpFirmaSymbol,
    );
    if (symbolMatches.length === 1) {
      return { id: symbolMatches[0].id, confidence: 1, ambiguous: false };
    }
    if (symbolMatches.length > 1) {
      return {
        confidence: 1,
        ambiguous: true,
        alternatives: symbolMatches.map((c) => ({ id: c.id, confidence: 1 })),
      };
    }
  }

  const exactMatches = candidates.filter((c) => normalize(c.name) === normalize(source.name));
  if (exactMatches.length === 1) {
    return { id: exactMatches[0].id, confidence: 1, ambiguous: false };
  }
  if (exactMatches.length > 1) {
    return {
      confidence: 1,
      ambiguous: true,
      alternatives: exactMatches.map((c) => ({ id: c.id, confidence: 1 })),
    };
  }

  const scored = candidates
    .map((c) => ({ id: c.id, name: c.name, confidence: similarity(source.name, c.name) }))
    .sort((a, b) => b.confidence - a.confidence);

  const top = scored[0];
  if (!top || top.confidence < FUZZY_MATCH_THRESHOLD) {
    return { confidence: top?.confidence ?? 0, ambiguous: false };
  }

  // A high fuzzy score is not enough on its own: "Butelka 100 ml" scores 0.96
  // against "Butelka 200 ml" and "Cutis P" scores 0.97 against "Cutis Ł". If the
  // best candidate is a *different variant* (its numbers / line-codes / colours
  // differ), it's a different item — refuse the auto-match and leave the row
  // unmatched so the user links it once (an alias then makes it permanent).
  if (!sameVariant(source.name, top.name)) {
    return { confidence: top.confidence, ambiguous: false };
  }

  const second = scored[1];
  const ambiguous = !!second && top.confidence - second.confidence < 0.05;

  return {
    id: top.id,
    confidence: top.confidence,
    ambiguous,
    alternatives: ambiguous ? scored.slice(0, 3) : undefined,
  };
}
