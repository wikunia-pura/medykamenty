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
//   * a longer word may match a near-twin (one typo / inflection edit, never
//     on the first letter, never a prefix like "nie"/"bez") or be absorbed by
//     a join/split spelling ("tego"+"care" ⇄ "tegocare", exact only).
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

// Two longer words count as the same word only when they are a typo /
// inflection apart: at most ONE edit, not touching the first letter, and
// neither word is the other with something glued in front. A looser rule
// (≥0.7 similarity) used to equate chemically different materials:
// "metyloparaben"/"etyloparaben" (leading letter), "nierafinowane"/
// "rafinowane", "bezzapachowy"/"zapachowy" (negation prefix),
// "niskoczasteczkowy"/"wysokoczasteczkowy" (several edits).
//
// `loose` is for ranking suggestions the user picks from (never for an
// automatic link): it keeps the first-letter and glued-prefix rules but
// tolerates more edits (≥0.7 similarity), so a truncated or misspelt name
// ("Spirual" → "Spirualit") still shows up in the list.
function wordSimilar(a: string, b: string, loose: boolean): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a[0] !== b[0]) return false;
  if (a.endsWith(b) || b.endsWith(a)) return false;
  const dist = levenshtein(a, b);
  if (loose) return 1 - dist / Math.max(a.length, b.length) >= 0.7;
  return dist <= 1;
}

// Join/split tolerance: "tegocare" vs "tego care". A token is absorbed only
// when it EQUALS a run of ≥2 consecutive tokens of the other side, or is one
// piece of a run of its own side that equals a token of the other side.
// (Plain substring containment used to absorb "rafinowane" into
// "nierafinowane" and "zapachowy" into "bezzapachowy".)
function joinsTo(token: string, tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i++) {
    let acc = tokens[i];
    for (let j = i + 1; j < tokens.length && acc.length < token.length; j++) {
      acc += tokens[j];
      if (acc === token) return true;
    }
  }
  return false;
}

function splitOf(index: number, from: string[], to: string[]): boolean {
  for (let i = 0; i <= index; i++) {
    for (let j = Math.max(index, i + 1); j < from.length; j++) {
      const run = from.slice(i, j + 1).join('');
      if (to.includes(run)) return true;
    }
  }
  return false;
}

// Is every token of `from` explained by some token of `to`?
function covers(from: string[], to: string[], loose: boolean): boolean {
  return from.every((t, idx) => {
    if (/^\d+$/.test(t) || t.length <= 2) return to.includes(t);
    if (to.some((u) => u.length > 2 && wordSimilar(t, u, loose))) return true;
    return joinsTo(t, to) || splitOf(idx, from, to);
  });
}

// `opts.loose` — suggestion ranking only, see wordSimilar.
export function sameVariant(a: string[], b: string[], opts: { loose?: boolean } = {}): boolean {
  const loose = opts.loose ?? false;
  return covers(a, b, loose) && covers(b, a, loose);
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
