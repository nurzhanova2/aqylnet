import { runningLineTexts } from './documentSections';
import { quoteKey } from './promptSafety';

// ─── Where a quote sits, and what that does to its finding (A1 stage 0a) ──
//
// Two rules decided after the first acceptance (03.11.2026), both in code
// because the prompt could not hold them:
//
//   - a finding whose quote lies entirely inside a running header or footer is
//     dropped. Two of three false Critical findings on the test documents were
//     about the line "[ТЕСТ] Синтетический образец — цифры вымышлены", repeated
//     on every page; the prompt said not to judge such lines, and the model did;
//   - a Critical finding whose quote comes from a table row is lowered to High.
//     pdf-parse glues table cells ("18,622,426,129,3"), and the model reads
//     contradictions and missing units into the glued digits. A table can be
//     wrong, but not on the strength of a reading of glued digits. Other
//     Critical findings are left alone.

/** The pieces of a quote around "..." / "…", folded — the form documents are searched in. */
function pieces(quote: string): string[] {
  return String(quote ?? '').split(/\.\.\.|…/).map(quoteKey).filter((p) => p.length > 0);
}

/** True when every piece of `quote` lies inside one of `regions`. */
function within(quote: string, regions: string[]): boolean {
  const ps = pieces(quote);
  if (ps.length === 0) return false;
  return regions.some((r) => {
    const f = quoteKey(r);
    return ps.every((p) => f.includes(p));
  });
}

/**
 * A line of a table as pdf-parse leaves it: three or more numbers, or a run of
 * glued digits, and hardly any words. "Онлайн-займы18,622,426,129,3" and
 * "1 1201 5401 8902 170" are rows; "увеличились до 29,3 и 17,6" is prose.
 *
 * The tail of a wrapped paragraph can look the same — "уровням и будут в
 * диапазоне 3,5-4,5% (график 5)." on the NBK reports — so a line that ends a
 * sentence, holds a sentence boundary or refers to a chart is not a row.
 */
export function isTableRow(line: string): boolean {
  const t = line.trim();
  if (/[.!?;:]$/.test(t) || /[.!?]\s+[А-ЯЁA-Z]/.test(t) || /\((график|таблиц|рисун|бокс)/i.test(t)) return false;
  const numbers = t.match(/\d+(?:[.,]\d+)?/g) ?? [];
  const glued = /\d[\d.,]{7,}/.test(t);
  const words = (t.match(/\p{L}{4,}/gu) ?? []).length;
  return (numbers.length >= 3 || glued) && words <= 4;
}

/** A short label fragment a table row wrapped onto: "организаций", "в % к ВВП". */
function isLabelFragment(line: string): boolean {
  const words = (line.match(/\p{L}+/gu) ?? []).length;
  return line.length <= 40 && words <= 3 && !/[.!?:;]$/.test(line);
}

/**
 * Tables of a document as text blocks: runs of consecutive lines that are
 * table rows or the label fragments around them, holding at least one row.
 */
export function tableBlocks(text: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  let hasRow = false;
  const flush = () => {
    if (hasRow && cur.length > 0) blocks.push(cur.join('\n'));
    cur = [];
    hasRow = false;
  };
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l) continue;
    if (isTableRow(l)) { cur.push(l); hasRow = true; }
    else if (isLabelFragment(l)) cur.push(l);
    else flush();
  }
  flush();
  return blocks;
}

/**
 * The document as quotes are checked against it: running headers and footers
 * removed. A sentence that crosses a page break is interrupted in the extracted
 * text by the footer of one page and the header of the next, so the model's
 * correct quote of it was not "verbatim" — measured on test1: the reason for
 * the decision was quoted word for word in three runs out of three and judged
 * absent each time. The header is not part of what the document says, here or
 * anywhere else.
 */
export function textForQuotes(documentText: string): string {
  const running = new Set(runningLineTexts(documentText));
  if (running.size === 0) return documentText;
  return documentText.split('\n').filter((l) => !running.has(l.trim())).join('\n');
}

export interface QuoteRegions {
  running: string[];
  tables:  string[];
}

export function quoteRegions(documentText: string): QuoteRegions {
  return { running: runningLineTexts(documentText), tables: tableBlocks(documentText) };
}

export function inRunningLine(quote: string, r: QuoteRegions): boolean {
  return within(quote, r.running);
}

/** A quote from a table row: inside a table block, and carrying a digit. */
export function fromTable(quote: string, r: QuoteRegions): boolean {
  return /\d/.test(quote) && within(quote, r.tables);
}

/**
 * A finding about text disagreeing with a table (decision of 03.11.2026).
 *
 * Every remaining false Critical of the 0a acceptance was this kind — "the text
 * says it grew, the table shows a fall" over a table whose values do grow —
 * and its quote was the prose under the table, so the table-row rule did not
 * reach it. Tables extracted from PDF are unreliable either way, so such a
 * finding is capped at High whatever it quotes. Recognised by its title: it
 * names the table and a disagreement.
 */
export function isTextTableMismatch(title: string): boolean {
  const t = String(title ?? '').toLowerCase().replace(/ё/g, 'е');
  return /таблиц/.test(t)
    && /(противореч|расхожд|неs+соответств|неs+совпада|неs+сходит|показыва|тогдаs+как|вs+тоs+времяs+как)/.test(t);
}

/**
 * Applies the rules. A finding quoting only a running line is dropped (a
 * contradiction if either of its quotes is — half of one is not a finding); a
 * Critical quoting a table row, or about text disagreeing with a table, is
 * lowered to High.
 */
export function applyQuoteRules<T extends { quote: string; quote2?: string; severity: string; title?: string }>(
  issues: T[],
  r: QuoteRegions,
): T[] {
  return issues
    .filter((i) => !(i.quote && inRunningLine(i.quote, r)) && !(i.quote2 && inRunningLine(i.quote2, r)))
    .map((i) => (i.severity === 'Critical' && ((i.quote && fromTable(i.quote, r)) || isTextTableMismatch(i.title ?? ''))
      ? { ...i, severity: 'High' }
      : i));
}
