// Shared "is this the same variant?" check, used by both the stock auto-matcher
// (matcher.ts) and the fuzzy suggestion ranker (smartMatcher.ts).
//
// Levenshtein alone can't tell "Butelka 100 ml" from "Butelka 200 ml" (one
// char) or "CBD 1%" from "CBD 10%" ("cbd 1" is even a prefix of "cbd 10", so a
// prefix bonus pushes the score to a full 1.0). The result was distinct items
// collapsing into one. This check answers, independently of the fuzzy score,
// whether two token lists denote the *same* item:
//
//   * a number ("100", "10") must appear verbatim — 100 is never a typo of 200,
//     nor 1 of 10;
//   * a short code (≤2 chars, e.g. line letter "p"/"l") must appear verbatim;
//   * a longer word may match a near-twin (typo / inflection / diacritics) or be
//     absorbed by a join/split spelling ("tego"+"care" ⇄ "tegocare").
//
// Any leftover token on either side means the names are *different* variants.
// Fully generic — no colour / keyword list — so "Dozownik biały" vs "Dozownik
// brylantowy" separates itself with no code change.

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

function wordSimilar(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  return 1 - levenshtein(a, b) / maxLen >= 0.7;
}

// Is every token of `from` explained by some token of `to`?
function covers(from: string[], to: string[]): boolean {
  const joined = to.join('');
  return from.every((t) => {
    if (/^\d+$/.test(t) || t.length <= 2) return to.includes(t);
    if (to.some((u) => u.length > 2 && wordSimilar(t, u))) return true;
    // join/split tolerance: "tegocare" vs "tego care"
    return joined.includes(t) || t.includes(joined);
  });
}

export function sameVariant(a: string[], b: string[]): boolean {
  return covers(a, b) && covers(b, a);
}

// Split a name into comparable tokens. Folds diacritics (incl. Polish ł, which
// NFD does not decompose) and lowercases, so "Ł"→"l" and "biała"→"biala", and
// drops "%" / "ml" punctuation so only words and bare numbers remain.
export function variantTokens(s: string): string[] {
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

// Convenience: are two raw names the same variant?
export function sameVariantNames(a: string, b: string): boolean {
  return sameVariant(variantTokens(a), variantTokens(b));
}
