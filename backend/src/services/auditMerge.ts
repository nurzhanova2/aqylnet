import {
  AuditAlignment,
  AuditIssue,
  AuditScore,
  AuditSection,
  ChecklistAnswer,
  ChecklistEvidence,
  ClaimDirection,
  ContradictionCandidate,
  ContradictionPair,
  DocumentAuditRaw,
  NumberedClaim,
  SectionAuditResult,
  computeOverallScore,
  sectionTitle,
} from './llm.service';
import { AUDIT_CHECKLIST, checklistItem } from '../config/auditChecklist';
import { CHECKLIST_START_CHARS, MAX_CONTRADICTION_CANDIDATES } from '../config/limits';
import { applyQuoteRules, quoteRegions, textForQuotes } from './auditQuoteRules';
import { isSingleSentence, isVerbatimQuote, quoteKey } from './promptSafety';

// ─── Merging section audits into one document audit ─────────
//
// Code, not a model (A1 stage 0). The document's numbers are aggregates, and
// the project's rule is that aggregates are computed, never named by the model
// — a document score the model announced after reading its own
// section notes would be a number nobody can trace.

export interface MergeSection {
  order:   number;
  heading: string | null;
  /** Length of the section's text — the weight of its scores. */
  length:  number;
  result:  SectionAuditResult;
}

const SEVERITY_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 };

/**
 * Document axes as the mean of the section axes, weighted by section length.
 *
 * Weighted because a two-paragraph conclusion and a five-page core section are
 * not equal shares of what a reader has to understand. Only analysed sections
 * count: a failed section has no scores, and treating it as zero would punish
 * the document for a network error. Each axis keeps the note of the section
 * that scored lowest on it — that is where the reason lives.
 */
export function mergeScores(sections: MergeSection[]): AuditScore[] {
  const byKey = new Map<string, { label: string; sum: number; weight: number; worst: { value: number; note: string } }>();
  for (const s of sections) {
    if (!s.result.ok) continue;
    const w = Math.max(1, s.length);
    for (const sc of s.result.scores) {
      const cur = byKey.get(sc.key);
      if (!cur) {
        byKey.set(sc.key, { label: sc.label, sum: sc.value * w, weight: w, worst: { value: sc.value, note: sc.note } });
      } else {
        cur.sum += sc.value * w;
        cur.weight += w;
        if (sc.value < cur.worst.value) cur.worst = { value: sc.value, note: sc.note };
      }
    }
  }
  return [...byKey].map(([key, v]) => ({
    key,
    label: v.label,
    value: Math.round(v.sum / v.weight),
    note: v.worst.note,
  }));
}

/**
 * All sections' findings, with duplicates removed and codes reassigned.
 *
 * A duplicate is the same quote after normalisation (quoteKey): two sections
 * can only produce one when the model quoted across the boundary, and one
 * section sometimes repeats itself. The more severe copy is kept. Findings
 * without a quote are never merged — "the section lacks examples" said of two
 * sections is two findings.
 */
export function mergeIssues(sections: MergeSection[]): AuditIssue[] {
  const kept = new Map<string, Omit<AuditIssue, 'code'>>();
  const unquoted: Omit<AuditIssue, 'code'>[] = [];
  for (const s of sections) {
    if (!s.result.ok) continue;
    for (const issue of s.result.issues) {
      // A contradiction is identified by both its quotes: sharing the first
      // with an ordinary finding must not let either absorb the other.
      const k = issue.kind === 'contradiction'
        ? `${quoteKey(issue.quote)}|${quoteKey(issue.quote2 ?? '')}`
        : quoteKey(issue.quote);
      if (!k) { unquoted.push(issue); continue; }
      const prev = kept.get(k);
      if (!prev || (SEVERITY_RANK[issue.severity] ?? 9) < (SEVERITY_RANK[prev.severity] ?? 9)) kept.set(k, issue);
    }
  }
  const all = collapseAudiences([...kept.values(), ...unquoted]);
  // Stable sort keeps document order within a severity.
  all.sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
  return all.map((i, idx) => ({ ...i, code: `З-${String(idx + 1).padStart(2, '0')}` }));
}

/**
 * One finding per audience per document (decision of 03.11.2026).
 *
 * "What this means for depositors" is a property of the document, but each
 * section audit asks it of its own section — on the NBK reports it came back
 * from almost every section. The most severe copy is kept (the first in
 * document order among equals), and its `section` lists every section the
 * finding was raised in, so the reader still sees where.
 */
export function collapseAudiences<T extends { audience?: string; severity: string; section: string }>(issues: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const i of issues) if (i.audience) groups.set(i.audience, [...(groups.get(i.audience) ?? []), i]);
  const keep = new Map<T, T>();
  for (const group of groups.values()) {
    const best = group.reduce((a, b) => ((SEVERITY_RANK[b.severity] ?? 9) < (SEVERITY_RANK[a.severity] ?? 9) ? b : a));
    const sections = [...new Set(group.map((g) => g.section).filter(Boolean))];
    keep.set(best, { ...best, section: sections.join('; ') });
  }
  return issues.flatMap((i) => (!i.audience ? [i] : keep.has(i) ? [keep.get(i)!] : []));
}

/** The document map: the real sections, in order, failed ones included. */
export function mergeSections(sections: MergeSection[]): AuditSection[] {
  return [...sections].sort((a, b) => a.order - b.order).map((s) => {
    const title = sectionTitle(s.order, s.heading);
    if (!s.result.ok) {
      return { title, clarity: null, note: `Раздел не проанализирован: ${s.result.reason}.`, analyzed: false };
    }
    const clarity = s.result.scores.find((sc) => sc.key === 'clarity')?.value ?? null;
    return { title, clarity, note: s.result.note, analyzed: true };
  });
}

/**
 * The checklist verdicts, given by code (decision of 03.11.2026).
 *
 * The model returned at most one sentence per question. "есть" only when that
 * sentence is in the document word for word and is one sentence; anything
 * else — no quote, a quote not found, two sentences stitched together — is
 * "нет", which becomes "В документе нет: …". A question the model skipped is
 * "нет" as well: the call ran, and nothing was brought for it.
 */
export function judgeChecklist(
  evidence: ChecklistEvidence[] | null,
  documentText: string,
  firstSectionText = '',
): ChecklistAnswer[] | null {
  if (!evidence) return null;
  const byId = new Map(evidence.map((e) => [e.id, e]));
  return AUDIT_CHECKLIST.map((item) => {
    const e = byId.get(item.id) ?? { id: item.id, section: '', quote: '' };
    const quote = e.quote.trim();
    let reason = '';
    if (!quote) reason = 'в документе не найдено предложение, которое отвечает на вопрос';
    else if (!isSingleSentence(quote)) reason = 'приведено больше одного предложения';
    else if (!isVerbatimQuote(quote, documentText)) reason = 'приведённое предложение не найдено в документе дословно';
    else if (item.atStart && !startsEarly(quote, documentText, firstSectionText)) reason = 'приведённое предложение стоит не в начале документа';
    return { ...e, quote, answer: reason ? 'нет' : 'есть', reason };
  });
}

/**
 * Whether a verbatim quote begins in the document's first section or within
 * its first CHECKLIST_START_CHARS characters. Positions are compared in the
 * folded form quotes are matched in, so whitespace and case do not move them.
 */
export function startsEarly(quote: string, documentText: string, firstSectionText: string): boolean {
  const doc = quoteKey(documentText);
  const head = quoteKey(String(quote).split(/\.\.\.|…/)[0] ?? '');
  const at = head ? doc.indexOf(head) : -1;
  if (at < 0) return false;
  const limit = Math.max(
    quoteKey(documentText.slice(0, CHECKLIST_START_CHARS)).length,
    quoteKey(textForQuotes(firstSectionText)).length,
  );
  return at < limit;
}

/**
 * The checklist turned into findings, severity from code: each "нет" is an
 * absence — no quote, its weight from config/auditChecklist.ts by id.
 */
export function checklistIssues(answers: ChecklistAnswer[] | null | undefined): Omit<AuditIssue, 'code'>[] {
  const out: Omit<AuditIssue, 'code'>[] = [];
  for (const a of answers ?? []) {
    const item = checklistItem(a.id);
    if (!item || a.answer !== 'нет') continue;
    out.push({
      kind: 'absence', checkId: item.id, title: item.missing, severity: item.severity, category: item.category,
      quote: '', section: '', raisedBy: '', agreedBy: '', disputedBy: '',
    });
  }
  return out;
}

// ─── Contradiction candidates, paired in code ──────────────────

/**
 * Directions that cannot both hold for one phenomenon at one time. Growth that
 * slows down is still growth, so "растёт" and "замедляется" are not a pair;
 * "снижается" and "ускоряется" are, the way inflation is spoken of ("инфляция
 * снижается" = slows).
 */
const OPPOSITE: ReadonlySet<string> = new Set([
  'растёт|снижается', 'растёт|стабилизировалось', 'снижается|стабилизировалось',
  'ускоряется|замедляется', 'ускоряется|стабилизировалось', 'снижается|ускоряется',
]);

export function opposite(a: ClaimDirection, b: ClaimDirection): boolean {
  return OPPOSITE.has(`${a}|${b}`) || OPPOSITE.has(`${b}|${a}`);
}

const PERIOD_WORD = /^(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|квартал|полугод|год|месяц|период)/;
const STOP = new Set(['для', 'при', 'над', 'под', 'или', 'как', 'его', 'это', 'том', 'числе', 'конец', 'начало', 'конца', 'начала']);

/** A phenomenon as a set of crude stems: "Инфляционные ожидания населения, октябрь 2026" → инфляц ожидан населе. */
export function phenomenonStems(s: string): Set<string> {
  const words = String(s ?? '').toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w) && !PERIOD_WORD.test(w));
  return new Set(words.map((w) => w.slice(0, 6)));
}

/**
 * One phenomenon: the stem sets are equal, or the smaller one (two stems at
 * least) is inside the larger one — "инфляционные ожидания населения" and
 * "инфляционные ожидания населения в отдельных группах". A loose match is fine
 * here: every candidate is read by the model, which rejects different groups.
 */
export function samePhenomenon(a: string, b: string): boolean {
  const x = phenomenonStems(a);
  const y = phenomenonStems(b);
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  if (small.size === 0) return false;
  if (small.size === 1) return large.size === 1 && [...small][0] === [...large][0];
  return [...small].every((w) => large.has(w));
}

/**
 * Candidate contradictions: one phenomenon, opposite directions, both facts or
 * both forecasts, different sections, both quotes verbatim in the document.
 * Quotes are checked here and not after the confirmation, so a pair that could
 * never be shown is not paid for.
 */
export function contradictionCandidates(claims: NumberedClaim[], documentText: string): ContradictionCandidate[] {
  const ok = claims.filter((c) => isVerbatimQuote(c.quote, documentText));
  const out: ContradictionCandidate[] = [];
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      const a = ok[i]!;
      const b = ok[j]!;
      if (a.section === b.section || a.type !== b.type || !opposite(a.direction, b.direction)) continue;
      if (!samePhenomenon(a.phenomenon, b.phenomenon)) continue;
      out.push({ k: out.length + 1, a, b });
      if (out.length >= MAX_CONTRADICTION_CANDIDATES) return out;
    }
  }
  return out;
}

/**
 * Confirmed contradictions as findings. The section and verbatim rules are
 * checked again here — this is the function that decides what is shown, and it
 * must not depend on the model having been given only good pairs.
 */
export function contradictionIssues(
  pairs: ContradictionPair[],
  claims: NumberedClaim[],
  documentText: string,
): Omit<AuditIssue, 'code'>[] {
  const byId = new Map(claims.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: Omit<AuditIssue, 'code'>[] = [];
  for (const p of pairs) {
    const a = byId.get(p.a);
    const b = byId.get(p.b);
    if (!a || !b || a.section === b.section) continue;
    const key = [p.a, p.b].sort((x, y) => x - y).join('-');
    if (seen.has(key)) continue;
    if (!isVerbatimQuote(a.quote, documentText) || !isVerbatimQuote(b.quote, documentText)) continue;
    seen.add(key);
    out.push({
      kind: 'contradiction', title: p.title, category: 'logic', severity: 'High',
      quote: a.quote, section: a.section, quote2: b.quote, section2: b.section,
      raisedBy: '', agreedBy: '', disputedBy: '',
    });
  }
  return out;
}

export interface MergeExtras {
  documentText: string;
  /** Text of the document's first section — where "the main conclusion first" may stand. */
  firstSectionText?: string;
  checklist: ChecklistEvidence[] | null;
  claims: NumberedClaim[];
  contradictions: ContradictionPair[];
}

export function mergeAudit(sections: MergeSection[], alignment: AuditAlignment[], extras?: MergeExtras): DocumentAuditRaw {
  const scores = mergeScores(sections);
  // Verbatim checks run on the text without running headers and footers, the
  // same text reportTrust verifies the stored report against.
  const quoteText = extras ? textForQuotes(extras.documentText) : '';
  const checklist = extras ? judgeChecklist(extras.checklist, quoteText, extras.firstSectionText ?? '') : undefined;
  const extraIssues = extras
    ? [...contradictionIssues(extras.contradictions, extras.claims, quoteText), ...checklistIssues(checklist)]
    : [];
  // Header/footer quotes dropped, table-row Critical lowered (auditQuoteRules)
  // — before the dedupe, so a dropped copy cannot win it.
  const regions = extras ? quoteRegions(extras.documentText) : null;
  const ruled = regions
    ? sections.map((s) => (s.result.ok ? { ...s, result: { ...s.result, issues: applyQuoteRules(s.result.issues, regions) } } : s))
    : sections;
  // Section findings first, then the document-level ones, through the same
  // dedupe and numbering.
  const issues = mergeIssues([...ruled, { order: -1, heading: null, length: 0, result: { ok: true, issues: extraIssues, scores: [], note: '', claims: [] } }]);
  return {
    // Provisional: no quote is verified yet, so only checklist absences cap
    // here. The stored value is recomputed after verification in
    // analyticsService.upsertAnalytics.
    overallScore: computeOverallScore(scores, issues),
    scores,
    issues,
    sections: mergeSections(sections),
    alignment,
    checklist,
  };
}
