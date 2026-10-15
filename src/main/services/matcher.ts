import { FUZZY_MATCH_THRESHOLD } from '../../shared/constants';
import { sameVariant, variantTokens } from './variantMatch';

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

// The fuzzy score is computed on a formatting-insensitive form (variantTokens:
// diacritics folded, punctuation dropped, digit/letter boundaries split) so
// "Tuba 50 ml." and "Tuba 50ml" both become "tuba 50 ml" and only real
// spelling differences lower the score.
function similarity(aC: string, bC: string): number {
  if (!aC.length && !bC.length) return 1;
  const maxLen = Math.max(aC.length, bC.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(aC, bC);
  return 1 - dist / maxLen;
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

  const sourceTokens = variantTokens(source.name.replace(INVISIBLE_CHARS, ''));
  const sourceC = sourceTokens.join(' ');
  const scored = candidates
    .map((c) => {
      const tokens = variantTokens(c.name.replace(INVISIBLE_CHARS, ''));
      return {
        id: c.id,
        name: c.name,
        confidence: similarity(sourceC, tokens.join(' ')),
        // A high fuzzy score is not enough on its own: "Butelka 100 ml" scores
        // 0.96 against "Butelka 200 ml", "Metyloparaben" 0.92 against
        // "Etyloparaben". A candidate whose numbers / line-codes / words
        // differ (see ./variantMatch) is a different item, never a match.
        sameVariant: sameVariant(sourceTokens, tokens),
      };
    })
    .sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  if (!best || best.confidence < FUZZY_MATCH_THRESHOLD) {
    return { confidence: best?.confidence ?? 0, ambiguous: false };
  }

  // Skip different-variant candidates and take the best SAME-variant one —
  // "Tuba 50ml" vs ["Tuba 60ml", "Tuba 50 ml."] must land on the second.
  // Different variants are not competitors for the ambiguity check either.
  const sameVariants = scored.filter((c) => c.sameVariant);
  const top = sameVariants[0];
  if (!top || top.confidence < FUZZY_MATCH_THRESHOLD) {
    // Nothing usable above the threshold: leave the row unmatched so the
    // user links it once (an alias then makes it permanent).
    return { confidence: top?.confidence ?? 0, ambiguous: false };
  }

  const second = sameVariants[1];
  const ambiguous = !!second && top.confidence - second.confidence < 0.05;

  return {
    id: top.id,
    confidence: top.confidence,
    ambiguous,
    alternatives: ambiguous
      ? sameVariants.slice(0, 3).map((c) => ({ id: c.id, confidence: c.confidence }))
      : undefined,
  };
}
