import {
  SECTION_MAX_CHARS,
  SECTION_MIN_CHARS,
  SECTION_TARGET_CHARS,
} from '../config/limits';

// ─── Splitting a document into sections (A1, stage 0) ────────
//
// The audit reads a document section by section, so sections are a real
// structure computed once when the text is attached, not a guess the model
// makes about page one. The rules were measured on what the product's own
// parser returns (pdf-parse / mammoth), not on the document as a person sees
// it — see .ai/MEASUREMENTS-15PAGES.md §4:
//
//   - pdf-parse returns one line per *printed* line, so the first line of every
//     paragraph looks like a heading by every test except width;
//   - running headers and footers repeat on every page and sit between the end
//     of one sentence and the start of the next;
//   - mammoth (DOCX) returns one paragraph per table cell, which drags any
//     statistic over "all lines" towards a few characters.
//
// The one hard invariant: sections are contiguous slices of the stored text,
// in order, covering it without gaps or overlaps — so
// `text.slice(startOffset, endOffset) === section.text` for every section, and a
// quote found in a section can always be located in the whole document.
// Nothing is removed from the text; running headers are only ignored when
// looking for headings.
//
// CAVEAT carried over from the measurement: the heading rules were tuned over
// three iterations on two synthetic documents (LibreOffice PDF and DOCX). They
// have not yet been checked against real NBK layout.

export interface DocumentSectionDraft {
  order:       number;
  /** The heading(s) the section starts with; null when it starts without one. */
  heading:     string | null;
  text:        string;
  startOffset: number;
  endOffset:   number;
}

export type SplitMethod = 'numbered' | 'unnumbered' | 'fallback' | 'empty';

interface Line { text: string; start: number }

const SENTENCE_END = /[.!?:;»")]\s*$/;
// Up to three levels ("1.1.1. Товарные рынки") — NBK reports use the third, and
// missing it also lost the "1.1." heading standing right above it.
const NUMBERED = /^(\d{1,2})((?:\.\d{1,2}){0,2})\.?\s+([А-ЯЁA-Z].{2,110})$/;
// Chapters of NBK monetary-policy reports are numbered I–VII. Only valid
// numerals up to XII, followed by a capitalised title — so "V" in running text
// or a "IV квартал" line cannot pass. Cyrillic І and Х, which Kazakh-language
// layouts use for the same glyphs, are folded to Latin first.
const ROMAN = /^(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)\.?\s+([А-ЯЁA-Z«].{2,110})$/;
// Captions of figures, boxes and tables sit on their own short line and look
// like headings by every other test — but a chart is not a section. Checked
// on the title with any leading number removed ("1.1 График …").
const CAPTION = /^(график|графики|рисунок|рис\.|таблица|табл\.|бокс|врезка|диаграмма|схема|источник|источники|примечание|справочно)(?![\p{L}])/iu;

function isCaption(title: string): boolean {
  return CAPTION.test(title.replace(/^([\dIVXІХ]{1,4}(\.\d{1,2})*\.?)\s+/u, ''));
}

// A table of contents repeats every heading with its page number at the end
// ("1.3. Риски в среднесрочной перспективе 10"). Measured on the NBK monetary
// policy reports: without this the whole contents page became headings of the
// first section. One to three digits — a year at the end of a real heading
// ("Итоги 2025") is four.
const TOC_ENTRY = /\s\d{1,3}$/;

// A heading set in capitals ("РЕШЕНИЕ ПО БАЗОВОЙ СТАВКЕ ОТ 6 МАРТА 2026 ГОДА")
// may carry digits, so the shape rule for unnumbered headings cannot see it.
// Treated like a numbered heading: in NBK reports capitals mark the decision
// page and the report's own title, i.e. structure, not emphasis.
function isCapsTitle(t: string): boolean {
  const letters = t.match(/\p{L}/gu) ?? [];
  if (letters.length < 8 || t.length > 110 || t.split(/\s+/).length < 2) return false;
  const upper = letters.filter((c) => c !== c.toLowerCase()).length;
  return upper / letters.length >= 0.9;
}

function numberedTitle(t: string): boolean {
  if (NUMBERED.test(t)) return true;
  const latin = t.replace(/^[ІХ]+/u, (m) => m.replace(/І/g, 'I').replace(/Х/g, 'X'));
  return ROMAN.test(latin);
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (t.length > 0) out.push({ text: t, start: pos });
    pos += raw.length + 1;
  }
  return out;
}

/**
 * Lines that recur on most pages and are made of words: running headers and
 * footers. Five repeats and fifteen letters, digits masked so "стр. 3" and
 * "стр. 4" count as one line. The first version took any line repeated three
 * times and also swallowed table header rows ("Показатель2023202420252026"),
 * whole rows of numbers and wrapped label fragments ("тенге").
 */
function runningLines(all: Line[]): Set<string> {
  const mask = (s: string) => s.replace(/\d+/g, '#');
  const counts = new Map<string, number>();
  for (const l of all) counts.set(mask(l.text), (counts.get(mask(l.text)) ?? 0) + 1);
  const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
  return new Set([...counts]
    .filter(([m, n]) => n >= 5 && letters(m) >= 15 && m.length <= 160)
    .map(([m]) => m));
}

/**
 * The running header and footer lines of a document, as they stand in the text
 * — one entry per distinct line. The audit drops findings quoting only these
 * (auditQuoteRules.ts): a footer is not something the document says.
 */
export function runningLineTexts(text: string): string[] {
  const all = lines(text);
  const running = runningLines(all);
  const mask = (s: string) => s.replace(/\d+/g, '#');
  return [...new Set(all.filter((l) => running.has(mask(l.text))).map((l) => l.text))];
}

function looksLikeProse(l: Line | undefined): boolean {
  return !!l && l.text.length >= 40 && /[а-яё]{3,}/.test(l.text) && !/^[–—-]\s/.test(l.text);
}

interface Heading { kind: 'numbered' | 'caps' | 'unnumbered'; title: string; start: number }

export function findHeadings(text: string): Heading[] {
  const all = lines(text);
  const running = runningLines(all);
  const content = all.filter((l) => !running.has(l.text.replace(/\d+/g, '#')));

  // Width separates a heading from the first line of a PDF paragraph — relative
  // to the median *prose* line, so DOCX table cells do not drag it down.
  const lens = content.filter(looksLikeProse).map((l) => l.text.length).sort((a, b) => a - b);
  const medianLen = lens[Math.floor(lens.length / 2)] ?? 0;
  const maxHeading = Math.min(90, Math.floor(medianLen * 0.7));

  const found: Heading[] = [];
  content.forEach((l, i) => {
    const prev = content[i - 1];
    const next = content[i + 1];
    if (isCaption(l.text)) return;
    const structural = numberedTitle(l.text) || isCapsTitle(l.text);
    if (structural && TOC_ENTRY.test(l.text)) return;
    // A chapter heading is often followed straight by its first subheading
    // ("II. ТЕКУЩИЕ МАКРОЭКОНОМИЧЕСКИЕ УСЛОВИЯ" then "2.1. Инфляция"), so for
    // numbered and capitals headings another heading counts as what follows.
    // Measured: without this, chapter II of both NBK reports was missed.
    const nextIsHeading = !!next && (numberedTitle(next.text) || isCapsTitle(next.text)) && !TOC_ENTRY.test(next.text);
    // A closing bracket ends a heading as often as a sentence
    // ("3.1.2. Кредитный канал и депозиты (канал благосостояния)"), so for
    // numbered and capitals headings only real sentence punctuation disqualifies.
    // A short bold lead line under a numbered heading ("Темпы роста денежной
    // массы ускорились.") is still text, not a table cell.
    const nextIsText = !!next && next.text.length >= 20 && /[а-яё]{3,}/.test(next.text);
    if (structural && !/[.!?:;,]\s*$/.test(l.text) && (looksLikeProse(next) || nextIsText || nextIsHeading)) {
      found.push({ kind: numberedTitle(l.text) ? 'numbered' : 'caps', title: l.text, start: l.start });
      return;
    }
    if (!looksLikeProse(next)) return;
    // After the end of a sentence — or after a table: the last cell of a table
    // is a number, not a sentence, and a heading right after a table is
    // ordinary layout. "No word of three letters" is what a row of figures is.
    const afterSentence = !prev || SENTENCE_END.test(prev.text) || !/\p{L}{3,}/u.test(prev.text);
    const unnumbered =
      l.text.length >= 6 && l.text.length <= maxHeading &&
      /^[А-ЯЁA-Z]/.test(l.text) &&
      // Digits rule out table rows; commas rule out row labels such as
      // "Кредитный портфель, трлн тенге".
      !/[\d,]/.test(l.text) &&
      !/[.,;:–—-]$/.test(l.text) &&
      l.text.split(/\s+/).length <= 10 &&
      afterSentence;
    if (unnumbered) found.push({ kind: 'unnumbered', title: l.text, start: l.start });
  });
  return found;
}

/**
 * Where to cut [start, end) into `pieces` parts: the paragraph boundary nearest
 * each ideal point, else a line ending a sentence (PDF has no blank lines), else
 * a sentence end inside a line, else the ideal point itself.
 */
function cutPoints(text: string, start: number, end: number, pieces: number): number[] {
  const len = end - start;
  const cuts: number[] = [];
  const candidates: number[] = [];
  const slice = text.slice(start, end);
  for (const re of [/\n\s*\n/g, /[.!?»]\s*\n/g, /[.!?]\s+(?=[А-ЯЁA-Z«–—])/g]) {
    candidates.length = 0;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(slice)) !== null) candidates.push(start + m.index + m[0].length);
    if (candidates.length >= pieces - 1) break;
  }
  let prev = start;
  for (let k = 1; k < pieces; k++) {
    const ideal = start + Math.round((len * k) / pieces);
    const usable = candidates.filter((c) => c > prev + SECTION_MIN_CHARS / 4 && c < end - SECTION_MIN_CHARS / 4);
    const best = usable.length
      ? usable.reduce((a, b) => (Math.abs(b - ideal) < Math.abs(a - ideal) ? b : a))
      : ideal;
    if (best > prev && best < end) { cuts.push(best); prev = best; }
  }
  return cuts;
}

interface Span { start: number; end: number; headings: string[] }

export function splitDocument(text: string): { method: SplitMethod; sections: DocumentSectionDraft[] } {
  if (!text || text.trim().length === 0) return { method: 'empty', sections: [] };

  let headings = findHeadings(text);
  const numbered = headings.filter((h) => h.kind === 'numbered');
  let method: SplitMethod;
  if (numbered.length >= 3) {
    // Numbered and capitals headings are authoritative; a shape-only match in a
    // numbered document is more likely a false positive than a missed heading —
    // except before the first authoritative one, where a titled preamble
    // ("Резюме") lives. On the NBK reports the shape-only matches were the
    // opening lines of the narrow intro box.
    const firstStructural = headings.find((h) => h.kind !== 'unnumbered')!.start;
    headings = headings.filter((h) => h.kind !== 'unnumbered' || h.start < firstStructural);
    method = 'numbered';
  } else if (headings.length >= 3) {
    method = 'unnumbered';
  } else {
    headings = [];
    method = 'fallback';
  }

  // Raw spans: one per heading, plus whatever precedes the first one.
  const starts = [0, ...headings.map((h) => h.start).filter((s) => s > 0)];
  const raw: Span[] = starts.map((s, i) => ({
    start: s,
    end: starts[i + 1] ?? text.length,
    headings: headings.filter((h) => h.start === s).map((h) => h.title),
  }));

  // A span that is little more than its heading line — a chapter title directly
  // followed by its first subheading ("II. ТЕКУЩИЕ …" then "2.1. Инфляция") —
  // belongs to what follows it. Merged backwards it would end the previous
  // section with the next chapter's title, which is how the NBK reports first
  // came out.
  for (let i = raw.length - 2; i >= 0; i--) {
    if (raw[i].end - raw[i].start < 300) {
      raw[i + 1] = { start: raw[i].start, end: raw[i + 1].end, headings: [...raw[i].headings, ...raw[i + 1].headings] };
      raw.splice(i, 1);
    }
  }

  // Merge small neighbours forward: a 1 500-character subsection is not worth a
  // call of its own, and the audit needs context to judge it.
  // Never across the start of a chapter (a roman numeral or a heading in
  // capitals): a section that ends inside the next chapter mixes two topics the
  // document itself separates. A short last subsection of a chapter stays short
  // rather than borrowing the next chapter's opening.
  const startsChapter = (s: Span) => {
    const h = s.headings[0] ?? '';
    return isCapsTitle(h) || ROMAN.test(h.replace(/^[ІХ]+/u, (m) => m.replace(/І/g, 'I').replace(/Х/g, 'X')));
  };
  const merged: Span[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    const lastLen = last ? last.end - last.start : 0;
    const sLen = s.end - s.start;
    if (last && !startsChapter(s) && (lastLen < SECTION_MIN_CHARS || sLen < SECTION_MIN_CHARS / 2) && lastLen + sLen <= SECTION_MAX_CHARS) {
      last.end = s.end;
      last.headings.push(...s.headings);
    } else {
      merged.push({ ...s, headings: [...s.headings] });
    }
  }
  // A short last section ("Заключение") has nothing to merge forward into. It
  // is folded back even past SECTION_MAX_CHARS by up to 20%: a conclusion of a
  // page does not deserve a call of its own, and the measured stable range
  // reaches 9 953 characters.
  if (merged.length > 1) {
    const tail = merged[merged.length - 1];
    const prev = merged[merged.length - 2];
    if (tail.end - tail.start < SECTION_MIN_CHARS / 2 && tail.end - prev.start <= SECTION_MAX_CHARS * 1.2) {
      prev.end = tail.end;
      prev.headings.push(...tail.headings);
      merged.pop();
    }
  }

  // Split what is still too long — a long headed section, or the whole document
  // in the fallback — aiming at the target size.
  const spans: Span[] = [];
  for (const s of merged) {
    const len = s.end - s.start;
    const limit = s === merged[merged.length - 1] && merged.length > 1 ? SECTION_MAX_CHARS * 1.2 : SECTION_MAX_CHARS;
    if (len <= limit) { spans.push(s); continue; }
    const pieces = Math.ceil(len / SECTION_TARGET_CHARS);
    const cuts = cutPoints(text, s.start, s.end, pieces);
    const bounds = [s.start, ...cuts, s.end];
    bounds.slice(0, -1).forEach((b, i) => spans.push({ start: b, end: bounds[i + 1], headings: i === 0 ? s.headings : [] }));
  }

  return {
    method,
    sections: spans.map((s, order) => ({
      order,
      heading: s.headings.length ? s.headings.join(' / ').slice(0, 500) : null,
      text: text.slice(s.start, s.end),
      startOffset: s.start,
      endOffset: s.end,
    })),
  };
}
