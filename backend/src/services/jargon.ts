import { JARGON_DICTIONARY, JargonTerm } from '../config/jargonDictionary';

// Finding dictionary terms in text (A1 stage 1, criterion 6 of persona scores).
//
// The code, not the model, decides which terms a section contains: the persona
// is handed this list and only says which of them she does not understand.
// Density is unique terms per 1 000 words — a measure of how much jargon a
// section asks the reader to carry, independent of who reads it.

/** One form of config/jargonDictionary.ts as a regular expression. */
export function formToRegExp(form: string): RegExp {
  const words = form.trim().split(/\s+/).map((w) => {
    const stem = w.endsWith('*');
    const body = (stem ? w.slice(0, -1) : w)
      .toLowerCase().replace(/ё/g, 'е')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // A hyphen in PDF text may be followed by a line break.
      .replace(/-/g, '-\\s*');
    return stem ? `${body}[\\p{L}\\p{N}]*` : body;
  });
  // Unicode-aware boundaries: \b is ASCII-only in JavaScript.
  return new RegExp(`(?<![\\p{L}\\p{N}])${words.join('\\s+')}(?![\\p{L}\\p{N}])`, 'gu');
}

const COMPILED: { term: JargonTerm; res: RegExp[] }[] =
  JARGON_DICTIONARY.map((term) => ({ term, res: term.forms.map(formToRegExp) }));

function fold(text: string): string {
  return String(text ?? '').toLowerCase().replace(/ё/g, 'е');
}

export interface TermHit { canonical: string; count: number }

/** Dictionary terms present in `text`, each once, with the number of occurrences. */
export function findTerms(text: string): TermHit[] {
  const t = fold(text);
  const out: TermHit[] = [];
  for (const { term, res } of COMPILED) {
    let count = 0;
    for (const re of res) {
      re.lastIndex = 0;
      count += (t.match(re) ?? []).length;
    }
    if (count > 0) out.push({ canonical: term.canonical, count });
  }
  return out;
}

/**
 * Every occurrence of a dictionary term with its position (A1 stage 3, the
 * card's terms check). fold() keeps the length, so positions are the text's.
 */
export function termOccurrences(text: string): { canonical: string; start: number; end: number }[] {
  const t = fold(text);
  const out: { canonical: string; start: number; end: number }[] = [];
  for (const { term, res } of COMPILED) {
    for (const re of res) {
      re.lastIndex = 0;
      for (const m of t.matchAll(re)) out.push({ canonical: term.canonical, start: m.index!, end: m.index! + m[0].length });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function wordCount(text: string): number {
  return (String(text ?? '').match(/\p{L}+/gu) ?? []).length;
}

/** Unique dictionary terms per 1 000 words; 0 for an empty text. */
export function termDensity(text: string): number {
  const words = wordCount(text);
  if (words === 0) return 0;
  return Math.round((findTerms(text).length / words) * 1000 * 10) / 10;
}

/**
 * The dictionary term `word` names, as a persona wrote it — the canonical form
 * or any search form ("нейтральной ставки", "КДН"); null when it is not one.
 */
export function canonicalOf(word: string): string | null {
  const w = fold(word).trim();
  if (!w) return null;
  const hit = COMPILED.find(({ term, res }) =>
    fold(term.canonical) === w || res.some((re) => { re.lastIndex = 0; return re.test(w); }));
  return hit ? hit.term.canonical : null;
}

/** Whether `word` (as a persona wrote it) is one of the dictionary terms. */
export function isDictionaryTerm(word: string): boolean {
  return canonicalOf(word) !== null;
}

/**
 * A persona's unclear words for one section, split: the dictionary terms found
 * in that section (they feed criterion 6) and everything else (candidates for
 * the dictionary). A dictionary term the code did not find in this section
 * counts for neither the score nor the candidates.
 */
export function splitUnclear(words: string[], foundInSection: string[]): { terms: string[]; others: string[] } {
  const found = new Set(foundInSection);
  const terms = new Set<string>();
  const others: string[] = [];
  for (const w of words) {
    const c = canonicalOf(w);
    if (c === null) others.push(w.trim());
    else if (found.has(c)) terms.add(c);
  }
  return { terms: [...terms], others: others.filter(Boolean) };
}
