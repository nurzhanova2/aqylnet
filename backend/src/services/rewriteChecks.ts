// Checks of the three versions of the text (A1 stage 3) — in code, never asked
// of the model. Pure functions.
//
// The main risk of the stage is an invented fact in a text that speaks for the
// National Bank. So every number of a new text must be found in the document,
// the decision must agree with the checked fields of the reference, the card
// may use a dictionary term only with an explanation in brackets, and what the
// document does not say is a visible placeholder for the author; every
// statement stands on a verbatim sentence of the document (its basis). No check
// fixes a text: each only marks it. null is «not checked».

import { BRIEF_MAX_WORDS, CARD_MAX_WORDS, READING_WORDS_PER_MINUTE } from '../config/limits';
import { DIRECTION_WORDS, sameValue } from './audienceRules';
import { termOccurrences } from './jargon';
import { isVerbatimQuote } from './promptSafety';
import type { DecisionReference } from '../validators/audienceAnalysis.validator';

/** The placeholder the author fills in: «[Дописать: … — в документе этого нет]». */
export const PLACEHOLDER_RE = /\[Дописать:[^\]]*\]/g;

export function placeholdersIn(text: string): string[] {
  return [...String(text ?? '').matchAll(PLACEHOLDER_RE)].map((m) => m[0]);
}

const withoutPlaceholders = (text: string) => String(text ?? '').replace(PLACEHOLDER_RE, ' ');

// ─── Numbers ─────────────────────────────────────────────────

const DATE_RE = /(?<!\d)(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?!\d)/g;
// «1 200», «1 200,5» — thousands with a (narrow) space; then plain numbers.
const NUMBER_RE = /(?<![\d.,])\d{1,3}(?:[   ]\d{3})+(?:[.,]\d+)?(?![\d])|(?<![\d])\d+(?:[.,]\d+)?/g;

const norm = (n: number) => String(Math.round(n * 1e6) / 1e6);

/**
 * Numbers of a text as normalised values: «16,25%» and «16.25 %» are 16.25,
 * «1 200» is 1200; a date «04.09.2026» is its day, month and year. Numbers
 * written as words are not counted (brief of 04.11.2026).
 */
export function numbersIn(text: string): { raw: string; value: string }[] {
  const out: { raw: string; value: string }[] = [];
  const rest = String(text ?? '').replace(DATE_RE, (m, d, mo, y) => {
    for (const part of [d, mo, y]) out.push({ raw: m, value: norm(Number(part)) });
    return ' ';
  });
  for (const m of rest.matchAll(NUMBER_RE)) {
    const n = Number(m[0].replace(/[   ]/g, '').replace(',', '.'));
    if (Number.isFinite(n)) out.push({ raw: m[0], value: norm(n) });
  }
  return out;
}

/** Every number of the document, normalised — what a new text may use. */
export function documentNumbers(documentText: string): Set<string> {
  return new Set(numbersIn(documentText).map((n) => n.value));
}

/** Numbers of `text` (placeholders aside) that the document does not have. */
export function missingNumbers(text: string, docNumbers: Set<string>): string[] {
  return [...new Set(numbersIn(withoutPlaceholders(text)).filter((n) => !docNumbers.has(n.value)).map((n) => n.raw))];
}

// ─── Sentences and volume ────────────────────────────────────

// A number with a decimal part is one word: «16,25».
const WORD_RE = /\d+(?:[.,]\d+)+|[\p{L}\p{N}]+(?:[-‑][\p{L}\p{N}]+)*/gu;

export function words(text: string): number {
  return (String(text ?? '').match(WORD_RE) ?? []).length;
}

/** Sentences of a text; a decimal comma or point does not end one. */
export function sentencesOf(text: string): string[] {
  return String(text ?? '').split(/(?<=[.!?…])\s+(?=[«"(\p{Lu}\d[])/u).map((s) => s.trim()).filter(Boolean);
}

/** The longest sentence in words, placeholders aside. */
export function longestSentence(text: string): number {
  return Math.max(0, ...sentencesOf(withoutPlaceholders(text)).map(words));
}

export function readingMinutes(text: string): number {
  return Math.round((words(text) / READING_WORDS_PER_MINUTE) * 10) / 10;
}

// ─── Terms ───────────────────────────────────────────────────

/**
 * Dictionary terms of the card with no explanation: a term is explained when
 * a bracket opens right after it, or when it stands inside brackets (it is
 * itself the explanation of a plainer word).
 */
export function unexplainedTerms(text: string): string[] {
  const t = String(text ?? '');
  const out = new Set<string>();
  for (const o of termOccurrences(t)) {
    const after = /^\s*\(/.test(t.slice(o.end));
    const before = t.slice(0, o.start);
    const inside = before.lastIndexOf('(') > before.lastIndexOf(')');
    if (!after && !inside) out.add(o.canonical);
  }
  return [...out];
}

// ─── The decision ────────────────────────────────────────────

export interface DecisionCheck { ok: boolean; reason: string }

/**
 * Does the text agree with the checked fields of the reference: the direction
 * word and the value. null when the reference has neither field checked.
 */
export function checkDecision(text: string, ref: Pick<DecisionReference, 'direction' | 'value'> | null): DecisionCheck | null {
  const dir = ref?.direction.value as keyof typeof DIRECTION_WORDS | null | undefined;
  const value = ref?.value.value as number | null | undefined;
  const words = dir ? DIRECTION_WORDS[dir] : undefined;
  if (!words && (value === null || value === undefined)) return null;
  const t = withoutPlaceholders(text);
  const problems: string[] = [];
  if (words && !words.test(t)) problems.push('не названо направление решения');
  if (typeof value === 'number' && !numbersIn(t).some((n) => sameValue(Number(n.value), value))) problems.push('не названа величина решения');
  return problems.length ? { ok: false, reason: `расходится с решением в документе: ${problems.join(', ')}` } : { ok: true, reason: '' };
}

// ─── Support: is a sentence backed by the document ──────────
//
// Decision of 04.11.2026, after the first run of stage 3: numbers alone let
// invented claims through («снижение доходности по новым депозитам», «сценарный
// анализ показывает…»). Every statement now carries `basis` — one verbatim
// sentence of the document — and the code checks that the basis is verbatim
// and that the statement's significant words (stems, service words aside) and
// all its numbers are in the basis or in the basis's section. In the full
// text a replacement is backed by the paragraph it replaces.

// Service words: prepositions, conjunctions, particles, pronouns, auxiliaries,
// and the words a plain-language rewrite adds around any fact («для вас»,
// «это значит»). Stems are compared, so the list holds whole short words.
const STOP_WORDS = new Set((
  'и в во не что он она оно они на я с со как а то все всё так его ее её но да ты к у же вы за бы по только мне было вот от '
  + 'меня еще ещё нет о об из ему теперь когда даже ну ли если уже или ни быть был была были будет будут него до вас нибудь '
  + 'уж вам ведь там потом себя ей может тут где есть надо ней для мы тебя их чем сам чтоб чтобы без чего раз тоже себе под '
  + 'ж тогда кто этот того потому этого какой ним здесь этом один мой тем нее сейчас куда всех можно при два другой хоть '
  + 'после над больше тот через эти нас про всего них какая много три эту моя свою этой перед том нельзя такой им более '
  + 'всегда это также который которая которое которые которых которым свой своих свои ваш ваша ваше ваши вашего вашей '
  + 'является являются значит означает поэтому однако при этом а также так как именно пока уже ещё очень весь вся'
).split(/\s+/).filter(Boolean));

const STEM_LENGTH = 5;
const stemOf = (w: string) => { const x = w.toLowerCase().replace(/ё/g, 'е'); return x.length <= STEM_LENGTH ? x : x.slice(0, STEM_LENGTH); };
const lettersWords = (text: string) => (withoutPlaceholders(text).match(/\p{L}+(?:-\p{L}+)*/gu) ?? []);

/** Stems of the significant words of a text: three letters or more, service words aside. */
export function significantStems(text: string): string[] {
  return [...new Set(lettersWords(text).filter((w) => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase().replace(/ё/g, 'е'))).map(stemOf))];
}

export interface SupportResult {
  ok:       boolean;
  /** Share of the statement's significant stems found in the pool. */
  coverage: number;
  missingWords:   string[];
  missingNumbers: string[];
}

/** Is `statement` backed by `pool`: coverage of significant stems ≥ the threshold, every number present. */
export function supportIn(statement: string, pool: string, minCoverage: number): SupportResult {
  const stems = significantStems(statement);
  const poolStems = new Set(lettersWords(pool).map(stemOf));
  const missingWords = lettersWords(statement)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w.toLowerCase().replace(/ё/g, 'е')) && !poolStems.has(stemOf(w)));
  const found = stems.filter((s) => poolStems.has(s)).length;
  const coverage = stems.length === 0 ? 1 : Math.round((found / stems.length) * 100) / 100;
  const missingNums = missingNumbers(statement, documentNumbers(pool));
  return { ok: coverage >= minCoverage && missingNums.length === 0, coverage, missingWords: [...new Set(missingWords)], missingNumbers: missingNums };
}

export interface SupportSource {
  /** The document without running lines — where a basis must be verbatim. */
  quoteText: string;
  /** Section texts: the pool is the basis and the section that holds it. */
  sections:  string[];
  minCoverage: number;
  /** «Проверить автору» below this coverage by the basis alone. */
  authorCheckBelow: number;
}

export interface ItemSupport {
  ok:            boolean;
  reason:        string;
  basis:         string;
  basisVerified: boolean;
  coverage:      number | null;
  missingWords:  string[];
  /** Coverage by the basis alone, without its section. */
  basisCoverage: number | null;
  /** Backed, but the basis alone covers it weakly: the author compares the two. */
  authorCheck:   boolean;
}

/** A statement against its basis: verbatim, then words and numbers in the basis or its section. */
export function checkSupport(statement: string, basis: string, src: SupportSource): ItemSupport {
  const b = String(basis ?? '').trim();
  const none = { basisCoverage: null, authorCheck: false };
  if (!b) return { ok: false, reason: 'нет опоры', basis: '', basisVerified: false, coverage: null, missingWords: [], ...none };
  if (!isVerbatimQuote(b, src.quoteText)) return { ok: false, reason: 'опора не найдена в документе дословно', basis: b, basisVerified: false, coverage: null, missingWords: [], ...none };
  const section = src.sections.find((s) => isVerbatimQuote(b, s)) ?? '';
  const r = supportIn(statement, `${b}\n${section}`, src.minCoverage);
  const why = [
    r.coverage < src.minCoverage ? `нет в опоре: ${r.missingWords.slice(0, 6).join(', ')}` : '',
    r.missingNumbers.length ? `числа не в опоре: ${r.missingNumbers.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  const basisCoverage = supportIn(statement, b, src.minCoverage).coverage;
  return {
    ok: r.ok, reason: r.ok ? '' : why, basis: b, basisVerified: true, coverage: r.coverage, missingWords: r.missingWords,
    basisCoverage, authorCheck: r.ok && basisCoverage < src.authorCheckBelow,
  };
}

// ─── «Не указано» instead of a placeholder ──────────────────

/** Saying that the document is silent, outside a placeholder (decision of 04.11.2026). */
const SILENCE_RE = /не\s+указ\p{L}*|не\s+содерж\p{L}*|не\s+сообща\p{L}*|документ\p{L}*\s+не\s|в\s+документе\s+(?:нет|отсутству)/iu;

export function mustBePlaceholder(text: string): boolean {
  return SILENCE_RE.test(withoutPlaceholders(text));
}

// ─── A piece of the new text ─────────────────────────────────

export interface ItemChecks {
  /** Numbers not found in the document; [] = all found. */
  numbers:   string[];
  /** Card only; null elsewhere. */
  terms:     string[] | null;
  longest:   number;
  long:      boolean;
  /** A statement with no section behind it (placeholders aside). */
  unsourced: boolean;
  /** null for a placeholder: nothing is stated. */
  support:   ItemSupport | null;
  /** «не указано», «документ не…» outside a placeholder. */
  mustBePlaceholder: boolean;
}

export interface RewriteItem {
  text:           string;
  basis:          string;
  sourceSections: number[];
  placeholder:    boolean;
  checks:         ItemChecks;
}

export interface ItemContext { docNumbers: Set<string>; maxWords: number; terms: boolean; support: SupportSource }

export const CARD_CONTEXT = (docNumbers: Set<string>, support: SupportSource): ItemContext => ({ docNumbers, maxWords: CARD_MAX_WORDS, terms: true, support });
export const BRIEF_CONTEXT = (docNumbers: Set<string>, support: SupportSource): ItemContext => ({ docNumbers, maxWords: BRIEF_MAX_WORDS, terms: false, support });

const hasOwnText = (text: string) => withoutPlaceholders(text).replace(/[\s.,;:—–\-()«»"]+/g, '').length > 0;

/** One sentence item, with its marks. A placeholder is one by its text, whatever the model said. */
export function checkItem(raw: { text: string; basis?: string; sourceSections: number[]; placeholder: boolean }, ctx: ItemContext): RewriteItem {
  const placeholder = placeholdersIn(raw.text).length > 0;
  const own = hasOwnText(raw.text);
  const longest = longestSentence(raw.text);
  return {
    text: raw.text,
    basis: raw.basis ?? '',
    sourceSections: own ? raw.sourceSections : [],
    placeholder,
    checks: {
      numbers: missingNumbers(raw.text, ctx.docNumbers),
      terms: ctx.terms ? unexplainedTerms(raw.text) : null,
      longest,
      long: longest > ctx.maxWords,
      unsourced: own && raw.sourceSections.length === 0,
      support: own ? checkSupport(withoutPlaceholders(raw.text), raw.basis ?? '', ctx.support) : null,
      mustBePlaceholder: mustBePlaceholder(raw.text),
    },
  };
}

const marked = (i: RewriteItem) => i.checks.numbers.length > 0 || (i.checks.terms?.length ?? 0) > 0 || i.checks.unsourced
  || i.checks.support?.ok === false || i.checks.support?.authorCheck === true || i.checks.mustBePlaceholder;

/** Summary of a version: volume, reading time, placeholders, marks. */
export function summarize(items: RewriteItem[], bounds: { min: number; max: number }) {
  const text = items.map((i) => i.text).join(' ');
  const chars = text.length;
  return {
    chars,
    withinVolume: chars >= bounds.min && chars <= bounds.max,
    minutes: readingMinutes(text),
    placeholders: items.flatMap((i) => placeholdersIn(i.text)),
    marks: items.filter(marked).length,
    numbersNotFound: items.reduce((a, i) => a + i.checks.numbers.length, 0),
    unsupported: items.filter((i) => i.checks.support?.ok === false).length,
    mustBePlaceholder: items.filter((i) => i.checks.mustBePlaceholder).length,
    authorChecks: items.filter((i) => i.checks.support?.authorCheck).length,
    longShare: items.length ? Math.round((items.filter((i) => i.checks.long).length / items.length) * 100) / 100 : 0,
  };
}

// ─── Paragraphs of the full text ─────────────────────────────

/** Paragraphs longer than this are cut at lines ending a sentence (PDF text). */
const PARAGRAPH_SPLIT_CHARS = 1_500;

/**
 * A section as paragraphs that partition it exactly: each slice keeps its
 * trailing separator, so joining the slices gives the section back byte for
 * byte. Blank lines first; a long block from PDF — at line breaks after the
 * end of a sentence.
 */
export function splitParagraphs(text: string): { start: number; end: number }[] {
  const cut = (from: number, to: number, re: RegExp) => {
    const out: { start: number; end: number }[] = [];
    let start = from;
    const body = text.slice(from, to);
    for (const m of body.matchAll(re)) {
      const end = from + m.index! + m[0].length;
      if (text.slice(start, end).trim()) { out.push({ start, end }); start = end; }
    }
    if (start < to) {
      if (out.length > 0 && !text.slice(start, to).trim()) out[out.length - 1]!.end = to;
      else out.push({ start, end: to });
    }
    return out;
  };
  const blocks = cut(0, text.length, /\n[ \t]*\n\s*/g);
  return blocks.flatMap((b) => (b.end - b.start > PARAGRAPH_SPLIT_CHARS ? cut(b.start, b.end, /(?<=[.!?…»])[ \t]*\n\s*/g) : [b]));
}

export interface Paragraph { id: string; order: number; start: number; end: number; text: string }

export function sectionParagraphs(order: number, sectionText: string, sectionStart: number): Paragraph[] {
  return splitParagraphs(sectionText).map((p, i) => ({
    id: `s${order + 1}p${i + 1}`, order, start: sectionStart + p.start, end: sectionStart + p.end, text: sectionText.slice(p.start, p.end),
  }));
}

export const INSERT_KINDS = ['placeholder', 'from_document', 'term_definition'] as const;
export type InsertKind = typeof INSERT_KINDS[number];

export interface RawEdit {
  paragraphId: string;
  action:      'replace' | 'insert_after';
  /** insert_after only; anything else drops the insert. */
  kind:        string;
  text:        string;
  /** from_document: each sentence with its verbatim basis. */
  sentences:   { text: string; basis: string }[];
  /** term_definition: the dictionary term defined. */
  term:        string;
  reason:      string;
  issueId:     string;
  missingId:   string;
}

export interface FullParagraph {
  id:        string;
  order:     number;
  status:    'same' | 'changed' | 'added';
  text:      string;
  /** The text before the edit, for «изменено». */
  before:    string | null;
  reason:    string;
  issueId:   string | null;
  missingId: string | null;
  /** insert_after only. */
  kind:      InsertKind | null;
  checks:    {
    numbers: string[];
    placeholders: string[];
    mustBePlaceholder: boolean;
    /** term_definition: the author checks the definition. */
    authorCheck: boolean;
    /** The weakest support of the edit's sentences; null for a placeholder or a definition. */
    coverage: number | null;
    /** from_document: the basis of each sentence, shown on hover. */
    bases: string[];
    /** replace: numbers of the source paragraph the replacement no longer has. */
    removedNumbers: string[];
  } | null;
}

export interface AppliedSection {
  paragraphs: FullParagraph[];
  applied:    number;
  dropped:    { unknownParagraph: number; noLink: number; duplicate: number; newContent: number };
  /** The byte check failed: every edit of the section was dropped. */
  error:      string | null;
}

export interface EditContext {
  issueIds:   Set<string>;
  missingIds: Set<string>;
  docNumbers: Set<string>;
  support:    SupportSource;
  /** Is this a dictionary term (term_definition). */
  isTerm:     (term: string, text: string) => boolean;
}

const trailing = (s: string) => /\s*$/.exec(s)![0];

/**
 * How an edit stands on the document (decision of 04.11.2026), or null when
 * it does not and is dropped as new content:
 *   - replace — every sentence backed by the paragraph it replaces;
 *   - insert_after placeholder — placeholders and nothing else;
 *   - insert_after from_document — every sentence with a verbatim basis that
 *     backs it;
 *   - insert_after term_definition — a dictionary term named in the text;
 *     kept, marked «проверить автору».
 */
export function editSupport(e: RawEdit, source: Paragraph, ctx: EditContext): { text: string; kind: InsertKind | null; coverage: number | null; bases: string[]; authorCheck: boolean } | null {
  if (e.action === 'replace') {
    const sentences = sentencesOf(withoutPlaceholders(e.text)).filter(hasOwnText);
    const results = sentences.map((s) => supportIn(s, source.text, ctx.support.minCoverage));
    if (results.some((r) => !r.ok)) return null;
    // Every replacement is for the author (decision of 04.11.2026): the check
    // sees the paragraph's words, not whether their relations survived.
    return { text: e.text, kind: null, coverage: results.length ? Math.min(...results.map((r) => r.coverage)) : null, bases: [], authorCheck: true };
  }
  if (e.kind === 'placeholder') {
    return placeholdersIn(e.text).length > 0 && !hasOwnText(e.text) ? { text: e.text, kind: 'placeholder', coverage: null, bases: [], authorCheck: false } : null;
  }
  if (e.kind === 'from_document') {
    const ss = e.sentences.filter((s) => s.text.trim());
    if (ss.length === 0) return null;
    const checks = ss.map((s) => checkSupport(withoutPlaceholders(s.text), s.basis, ctx.support));
    if (checks.some((c) => !c.ok)) return null;
    return { text: ss.map((s) => s.text.trim()).join(' '), kind: 'from_document', coverage: Math.min(...checks.map((c) => c.coverage ?? 1)), bases: ss.map((s) => s.basis), authorCheck: checks.some((c) => c.authorCheck) };
  }
  if (e.kind === 'term_definition') {
    return ctx.isTerm(e.term, e.text) ? { text: e.text, kind: 'term_definition', coverage: null, bases: [], authorCheck: true } : null;
  }
  return null;
}

/**
 * The model's edits applied by code. An unknown paragraph, an edit linked to
 * no given issue or missing item, a second replacement of one paragraph, and
 * an edit that does not stand on the document (editSupport) are dropped and
 * counted. Unchanged paragraphs are the source's slices; the assembled
 * section is checked against the source byte for byte — on a mismatch the
 * section keeps its source text and every edit is dropped.
 */
export function applyEdits(paragraphs: Paragraph[], edits: RawEdit[], ctx: EditContext): AppliedSection {
  const byId = new Map(paragraphs.map((p) => [p.id, p]));
  const dropped = { unknownParagraph: 0, noLink: 0, duplicate: 0, newContent: 0 };
  type Kept = Omit<RawEdit, 'kind'> & NonNullable<ReturnType<typeof editSupport>>;
  const replace = new Map<string, Kept>();
  const inserts = new Map<string, Kept[]>();
  for (const e of edits) {
    const source = byId.get(e.paragraphId);
    if (!source) { dropped.unknownParagraph++; continue; }
    const issueId = ctx.issueIds.has(e.issueId) ? e.issueId : '';
    const missingId = ctx.missingIds.has(e.missingId) ? e.missingId : '';
    if (!issueId && !missingId) { dropped.noLink++; continue; }
    if (e.action === 'replace' && replace.has(e.paragraphId)) { dropped.duplicate++; continue; }
    const s = editSupport(e, source, ctx);
    if (!s) { dropped.newContent++; continue; }
    const kept: Kept = { ...e, issueId, missingId, ...s };
    if (e.action === 'replace') replace.set(e.paragraphId, kept);
    else inserts.set(e.paragraphId, [...(inserts.get(e.paragraphId) ?? []), kept]);
  }
  const checks = (k: Kept, source?: Paragraph) => ({
    numbers: missingNumbers(k.text, ctx.docNumbers), placeholders: placeholdersIn(k.text), mustBePlaceholder: mustBePlaceholder(k.text),
    authorCheck: k.authorCheck, coverage: k.coverage, bases: k.bases,
    removedNumbers: source ? removedNumbers(source.text, k.text) : [],
  });
  const same = (p: Paragraph): FullParagraph => ({ id: p.id, order: p.order, status: 'same', text: p.text, before: null, reason: '', issueId: null, missingId: null, kind: null, checks: null });
  const out: FullParagraph[] = [];
  for (const p of paragraphs) {
    const r = replace.get(p.id);
    out.push(r
      ? { id: p.id, order: p.order, status: 'changed', text: r.text.trim() + trailing(p.text), before: p.text, reason: r.reason, issueId: r.issueId || null, missingId: r.missingId || null, kind: null, checks: checks(r, p) }
      : same(p));
    (inserts.get(p.id) ?? []).forEach((ins, i) => out.push({
      id: `${p.id}+${i + 1}`, order: p.order, status: 'added', text: `${ins.text.trim()}\n\n`, before: null, reason: ins.reason,
      issueId: ins.issueId || null, missingId: ins.missingId || null, kind: ins.kind, checks: checks(ins),
    }));
  }
  const sameOk = out.filter((x) => x.status === 'same').every((x) => x.text === byId.get(x.id)!.text);
  if (!sameOk) return { paragraphs: paragraphs.map(same), applied: 0, dropped, error: 'неизменные абзацы не совпали с исходником — правки раздела отброшены' };
  return { paragraphs: out, applied: replace.size + [...inserts.values()].reduce((a, l) => a + l.length, 0), dropped, error: null };
}

/**
 * Numbers of the source paragraph that its replacement no longer has
 * (decision of 04.11.2026). A replacement that drops a forecast loses data
 * silently; on the press release s1p16 lost the 2026 and 2028 forecasts.
 */
export function removedNumbers(before: string, after: string): string[] {
  const kept = new Set(numbersIn(after).map((n) => n.value));
  return [...new Set(numbersIn(before).filter((n) => !kept.has(n.value)).map((n) => n.raw))];
}

/** Unchanged paragraphs that match the source byte for byte, out of all unchanged. */
export function unchangedIntegrity(paragraphs: FullParagraph[], documentText: string, source: Paragraph[]): { same: number; matching: number } {
  const byId = new Map(source.map((p) => [p.id, p]));
  const same = paragraphs.filter((p) => p.status === 'same');
  return { same: same.length, matching: same.filter((p) => { const s = byId.get(p.id); return !!s && p.text === documentText.slice(s.start, s.end); }).length };
}

export type IssueStatus = 'in_quote_paragraph' | 'wrong_paragraph' | 'no_edit';

/**
 * Where the edits of an issue landed (decision of 04.11.2026 — «исправлено»
 * is gone): on the paragraph holding the issue's quote (an insertion counts
 * by the paragraph it follows; a quote across a paragraph break — by either),
 * elsewhere, or nowhere.
 */
export function issueStatus(quote: string, sectionParagraphs: Paragraph[], applied: FullParagraph[], issueId: string): IssueStatus {
  const edits = applied.filter((p) => p.status !== 'same' && p.issueId === issueId);
  if (edits.length === 0) return 'no_edit';
  const holding = new Set<string>();
  if (quote) {
    sectionParagraphs.forEach((p) => { if (isVerbatimQuote(quote, p.text)) holding.add(p.id); });
    // Only a quote no single paragraph holds is looked for across a break.
    if (holding.size === 0) {
      sectionParagraphs.forEach((p, i) => {
        const next = sectionParagraphs[i + 1];
        if (next && isVerbatimQuote(quote, p.text + next.text)) { holding.add(p.id); holding.add(next.id); }
      });
    }
  }
  return edits.some((e) => holding.has(e.id.split('+')[0]!)) ? 'in_quote_paragraph' : 'wrong_paragraph';
}
