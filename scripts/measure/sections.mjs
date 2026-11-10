// A sketch of the section splitter A1 needs, run against what the product's
// parser actually returns — not against the document as a person sees it.
//
// Three stages, each one a fallback for the one before:
//
//   1. clean   — drop running headers and footers. Detected generically, as
//                lines that recur on many pages once digits are masked, so a
//                page number does not make every footer unique.
//   2. find    — headings. Numbered ones ("2.", "2.1 ", "5.3 Кредитование")
//                first; unnumbered ones by shape: a short capitalised line
//                with no closing punctuation and no digits, preceded by the end
//                of a sentence and followed by prose. The neighbour conditions
//                are what keep table cells out — a wrapped cell like "Доля
//                беззалоговых займов в" looks like a heading on its own.
//   3. size    — merge neighbours below `min` and split anything above `max`
//                at paragraph (or, failing that, sentence) boundaries. The
//                bounds come from the measurement, not from this file.
//
// Every section keeps its offset in the cleaned text, because a quote found in
// a section has to be checkable against the whole document (ROADMAP A1 p.2).

const SENTENCE_END = /[.!?:;»")]\s*$/;
const NUMBERED = /^(\d{1,2})(\.\d{1,2})?\.?\s+([А-ЯЁA-Z].{2,110})$/;

export function cleanText(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const masked = lines.map((l) => l.trim().replace(/\d+/g, '#'));
  const counts = new Map();
  for (const m of masked) if (m.length > 0) counts.set(m, (counts.get(m) ?? 0) + 1);
  // A running header or footer: repeated on most pages and made of words.
  // The first version took any line repeated 3+ times, and so also removed
  // table header rows ("Показатель2023202420252026"), whole rows of numbers
  // ("#,#,#,#,#") and wrapped label fragments ("тенге") — the audit then saw
  // tables without headers and reported them as Critical. Five repeats and
  // fifteen letters keeps the footers and leaves the tables alone.
  const letters = (m) => (m.match(/\p{L}/gu) || []).length;
  const running = new Set([...counts].filter(([m, n]) => n >= 5 && letters(m) >= 15 && m.length <= 160).map(([m]) => m));
  const kept = lines.filter((_, i) => !running.has(masked[i]));
  return { text: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removedKinds: [...running] };
}

/** Non-empty lines with their start offsets. */
function lineIndex(text) {
  const out = [];
  let pos = 0;
  for (const raw of text.split('\n')) {
    if (raw.trim().length > 0) out.push({ text: raw.trim(), start: pos });
    pos += raw.length + 1;
  }
  return out;
}

function looksLikeProse(l) {
  return !!l && l.text.length >= 40 && /[а-яё]{3,}/.test(l.text) && !/^[–—-]\s/.test(l.text);
}

export function findHeadings(text) {
  const lines = lineIndex(text);
  // pdf-parse returns one line per *printed* line, so the opening line of
  // every paragraph is short of a full stop and looks like a heading by every
  // other test. What separates them is width: a heading is visibly shorter
  // than a full line. Relative to the median *prose* line — over all lines,
  // the table cells of a DOCX (one short paragraph per cell) drag the median
  // down to a few characters and no heading qualifies any more.
  const lens = lines.filter(looksLikeProse).map((l) => l.text.length).sort((a, b) => a - b);
  const medianLen = lens[Math.floor(lens.length / 2)] ?? 0;
  const maxHeading = Math.min(90, Math.floor(medianLen * 0.7));
  const found = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const afterSentence = !prev || SENTENCE_END.test(prev.text);
    const m = l.text.match(NUMBERED);
    if (m && !SENTENCE_END.test(l.text) && looksLikeProse(next)) {
      found.push({ kind: 'numbered', level: m[2] ? 2 : 1, title: l.text, start: l.start });
      return;
    }
    const unnumbered =
      l.text.length >= 6 && l.text.length <= maxHeading &&
      /^[А-ЯЁA-Z]/.test(l.text) &&
      // Commas mark table row labels ("Кредитный портфель, трлн тенге").
      !/[\d,]/.test(l.text) &&
      !/[.,;:–—-]$/.test(l.text) &&
      l.text.split(/\s+/).length <= 10 &&
      afterSentence && looksLikeProse(next);
    if (unnumbered) found.push({ kind: 'unnumbered', level: 1, title: l.text, start: l.start });
  });
  return found;
}

function splitOversize(sec, max) {
  if (sec.text.length <= max) return [sec];
  const out = [];
  // Paragraphs where the parser kept them (DOCX), sentences otherwise (PDF).
  const units = sec.text.includes('\n\n') ? sec.text.split(/(?<=\n\n)/) : sec.text.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«–—])/);
  let buf = '';
  let offset = sec.start;
  let bufStart = offset;
  const pieces = Math.ceil(sec.text.length / max);
  const target = Math.ceil(sec.text.length / pieces);
  for (const u of units) {
    if (buf.length > 0 && buf.length + u.length > target) {
      out.push({ ...sec, text: buf, start: bufStart, part: out.length + 1 });
      bufStart = offset;
      buf = '';
    }
    buf += (buf && !buf.endsWith('\n') && !sec.text.includes('\n\n') ? ' ' : '') + u;
    offset += u.length + (sec.text.includes('\n\n') ? 0 : 1);
  }
  if (buf) out.push({ ...sec, text: buf, start: bufStart, part: out.length + 1 });
  return out;
}

/**
 * @returns {{sections: {title:string,start:number,text:string,headings:string[]}[], method:string, headings:object[]}}
 */
export function splitSections(rawText, { min = 4000, max = 9000 } = {}) {
  const { text } = cleanText(rawText);
  let headings = findHeadings(text);
  // Numbered headings, when present, are authoritative: unnumbered matches on
  // the same document are more likely false positives than missed headings.
  const numbered = headings.filter((h) => h.kind === 'numbered');
  let method;
  if (numbered.length >= 3) {
    // Keep the short titled preamble ("Резюме") as well — it precedes "1.".
    headings = headings.filter((h) => h.kind === 'numbered' || h.start < numbered[0].start);
    method = 'numbered headings';
  } else if (headings.length >= 3) {
    method = 'unnumbered headings (by shape)';
  } else {
    headings = [];
    method = 'fallback: paragraphs + hard cap';
  }

  const starts = [0, ...headings.map((h) => h.start).filter((s) => s > 0)];
  let raw = starts.map((s, i) => {
    const end = starts[i + 1] ?? text.length;
    const h = headings.find((x) => x.start === s);
    return { title: h?.title ?? '(начало документа)', start: s, text: text.slice(s, end).trim(), headings: h ? [h.title] : [] };
  }).filter((s) => s.text.length > 0);
  const rawSections = raw.map((s) => ({ title: s.title, chars: s.text.length }));

  // Merge small neighbours forward: a subsection of 1 500 characters is not
  // worth a call of its own, and the audit needs context to judge it.
  const merged = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && (last.text.length < min || s.text.length < min * 0.5) && last.text.length + s.text.length <= max) {
      last.text += '\n\n' + s.text;
      last.headings.push(...s.headings);
    } else {
      merged.push({ ...s, headings: [...s.headings] });
    }
  }
  // A short last section ("Заключение") has nothing to merge forward into;
  // fold it back into the previous one, allowing a modest overshoot of max.
  const tail = merged[merged.length - 1];
  if (merged.length > 1 && tail.text.length < min * 0.5 && merged[merged.length - 2].text.length + tail.text.length <= max * 1.2) {
    const prev = merged[merged.length - 2];
    prev.text += '\n\n' + tail.text;
    prev.headings.push(...tail.headings);
    merged.pop();
  }
  const sections = merged.flatMap((s) => splitOversize(s, max * 1.2));
  return { cleanedText: text, method, headings, rawSections, sections };
}

export function sizeStats(xs) {
  const a = [...xs].sort((p, q) => p - q);
  if (a.length === 0) return { n: 0 };
  const med = a.length % 2 ? a[(a.length - 1) / 2] : Math.round((a[a.length / 2 - 1] + a[a.length / 2]) / 2);
  return { n: a.length, min: a[0], median: med, max: a[a.length - 1] };
}
