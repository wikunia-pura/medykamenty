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
//
// A variant guard then caps the score for candidates whose distinguishing
// tokens differ (CBD 1% vs CBD 10%, Butelka 100 vs 200 ml) so they can never
// be mistaken for the same item — see ./variantMatch.

import { sameVariant, variantTokens } from './variantMatch';

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
// Parenthetical chunks (), [], {} — often descriptive noise ("(99%)",
// "(BASF)"), but sometimes the identity itself ("Butelka (100 ml)"). Only the
// fuzzy SCORE ignores them (see looseNormalize); identity keys keep them.
const PAREN_NOISE = /[([{][^)\]}]*[)\]}]/g;
const BRACKET_CHARS = /[()[\]{}]/g;
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

// Identity key: used for the importers' smart-key lookups AND to store / look
// up aliases (alias_normalized). Numbers and units are IDENTITY for
// components ("Butelka 100 ml" vs "...200 ml", "Taśma ML 60 mb" vs "...120
// mb", "CBD 1" vs "CBD 10") — they must survive normalization, otherwise
// distinct items collapse to one key and their stocks get summed. We
// therefore keep digits and unit tokens, and only split digit↔letter
// boundaries so "100ml" and "100 ml" tokenize alike. Bracket CONTENTS are kept
// too (only the bracket characters go): "Butelka (100 ml)" and "Butelka (200
// ml)" used to share one key. Consequence: "Allantoina" no longer keys equal
// to "Allantoina (BASF)" — such pairs now surface as suggestions /
// "possible duplicate" warnings instead of silent matches. Changing this
// function changes the keys of already-stored aliases (alias_normalized).
export function normalize(s: string): string {
  if (!s) return '';
  return s
    .replace(INVISIBLE_CHARS, '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(BRACKET_CHARS, ' ')
    .replace(/&/g, ' ')
    .replace(PUNCT, ' ')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  // Keep single-character tokens: product-line codes ("Cutis P" vs "Cutis Ł")
  // and bare numbers ("CBD 1" vs "CBD 10") are discriminating, not noise.
  return normalized
    .split(' ')
    .filter((t) => t.length >= 1 && !FORM_NOISE.has(t));
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

// Score ceiling for a candidate that is a *different variant* of the source
// (its numbers / line-codes / qualifier words differ). Without it, "CBD 1%"
// scores a full 1.0 against "CBD 10%" ("cbd 1" is a prefix of "cbd 10", so the
// prefix bonus + near-identical Levenshtein saturate the score) and "Butelka
// 100 ml" looks identical to "Butelka 200 ml". Kept below every consumer
// threshold (0.55 suggestions, 0.85 duplicate warnings) so a wrong variant is
// never auto-picked or flagged as the same item — it just drops out of the list.
const VARIANT_MISMATCH_CAP = 0.4;

// Scoring form: `normalize` minus bracketed annotations, so "Allantoina"
// still scores 1.0 against "Allantoina (BASF)" in the suggestion list.
function looseNormalize(s: string): string {
  return normalize((s ?? '').replace(PAREN_NOISE, ' '));
}

const HAS_BRACKET_NOTE = /[([{][^)\]}]*[)\]}]/;
function hasBracketNote(s: string): boolean {
  return HAS_BRACKET_NOTE.test(s);
}

// Variant check on the RAW names (bracket contents included), so
// "Butelka (100 ml)" vs "Butelka (200 ml)" is a different variant. One
// allowance: when only ONE side carries a bracketed note, the note is
// treated as an annotation ("Gliceryna" vs "Gliceryna (99%)") and the names
// are compared without it.
function sameVariantForSuggestion(sourceRaw: string, candRaw: string): boolean {
  if (sameVariant(variantTokens(sourceRaw), variantTokens(candRaw), { loose: true })) return true;
  if (hasBracketNote(sourceRaw) === hasBracketNote(candRaw)) return false;
  return sameVariant(
    variantTokens(sourceRaw.replace(PAREN_NOISE, ' ')),
    variantTokens(candRaw.replace(PAREN_NOISE, ' ')),
    { loose: true },
  );
}

function scoreOne(
  sourceRaw: string,
  sourceNorm: string,
  sourceTokens: string[],
  candidateName: string,
): number {
  const candNorm = looseNormalize(candidateName);
  const candTokens = tokenize(candNorm);
  const lev = levenshteinSimilarity(sourceNorm, candNorm);
  const jac = tokenJaccard(sourceTokens, candTokens);
  const base = Math.max(lev, jac);
  const score = Math.min(1, base + prefixBonus(sourceNorm, candNorm));
  // Different numbers / line codes / words ("CBD 1%" vs "CBD 10%", "Butelka
  // (100 ml)" vs "(200 ml)", "Metyloparaben" vs "Etyloparaben") cap the score.
  if (!sameVariantForSuggestion(sourceRaw, candidateName)) {
    return Math.min(score, VARIANT_MISMATCH_CAP);
  }
  return score;
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

  const sourceNorm = looseNormalize(source.name);
  const sourceTokens = tokenize(sourceNorm);

  for (const c of candidates) {
    if (out.some((s) => s.id === c.id)) continue;
    let best = scoreOne(source.name, sourceNorm, sourceTokens, c.name);
    for (const alias of c.aliases ?? []) {
      const s = scoreOne(source.name, sourceNorm, sourceTokens, alias);
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

// Names compared with every bracketed note dropped — "Krem X (2025)" and
// "Krem X" give the same key. Not an identity key (it would merge
// "Butelka (100 ml)" with "Butelka (200 ml)"); only for decisions that must
// err on the side of treating names as the same thing: keeping catalog entries
// alive in an overwrite import, and the "possible duplicate" warning.
export function bracketlessKey(s: string): string {
  return looseNormalize(s);
}

/**
 * Near-duplicate check for the import warnings: like suggestMatches, but a
 * bracketed note on either side ("(Tocobiol)" vs "(daw. Tocobiol)") doesn't
 * hide a likely duplicate.
 */
export function findLikelyDuplicate(
  name: string,
  candidates: SuggestionCandidate[],
  threshold = 0.85,
): Suggestion | undefined {
  const strip = (s: string) => s.replace(PAREN_NOISE, ' ').replace(/\s+/g, ' ').trim();
  const top = suggestMatches(
    { name: strip(name) },
    candidates.map((c) => ({ ...c, name: strip(c.name), aliases: c.aliases?.map(strip) })),
    { limit: 1, threshold },
  )[0];
  if (!top) return undefined;
  const original = candidates.find((c) => c.id === top.id);
  return { ...top, name: original?.name ?? top.name };
}
