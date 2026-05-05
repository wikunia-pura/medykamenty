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

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
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
    .map((c) => ({ id: c.id, confidence: similarity(source.name, c.name) }))
    .sort((a, b) => b.confidence - a.confidence);

  const top = scored[0];
  if (!top || top.confidence < FUZZY_MATCH_THRESHOLD) {
    return { confidence: top?.confidence ?? 0, ambiguous: false };
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
