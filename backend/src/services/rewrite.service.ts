import { AUTHOR_CHECK_BASIS_COVERAGE, BRIEF_CHARS, CARD_CHARS, SUPPORT_MIN_COVERAGE, REWRITE_BLUF_VERSION, REWRITE_BRIEF_VERSION, REWRITE_CARD_VERSION, REWRITE_SECTION_CONCURRENCY, REWRITE_SECTION_VERSION } from '../config/limits';
import { PersonaGroupKey } from '../config/personaGroups';
import { projectRepository } from '../repositories/project.repository';
import { rewriteRepository } from '../repositories/rewrite.repository';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors';
import { mapLimit } from '../utils/mapLimit';
import { singleFlight } from '../utils/singleFlight';
import {
  BriefLayer, BriefLayerSchema, CardLayer, CardLayerSchema, FullLayer, FullLayerSchema, RewriteLayer, RewriteLayers,
} from '../validators/rewrite.validator';
import { DecisionReference } from '../validators/audienceAnalysis.validator';
import { ACTOR_LABELS, DIRECTION_LABELS } from './audienceRules';
import { audienceAnalysisService } from './audienceAnalysis.service';
import { analyticsService } from './analytics.service';
import { sectionsFor } from './documentSection.service';
import {
  generateBluf, generateBrief, generateCard, generateSectionEdits, RewriteContext, RewriteItemRaw, RewriteMissingInput,
  sectionTitle,
} from './llm.service';
import { assertDailyBudget, withUsageContext } from './llmUsage.service';
import { isVerbatimQuote } from './promptSafety';
import { textForQuotes } from './auditQuoteRules';
import { canonicalOf, termOccurrences } from './jargon';
import {
  applyEdits, BRIEF_CONTEXT, CARD_CONTEXT, checkDecision, checkItem, documentNumbers, EditContext, issueStatus, ItemContext,
  missingNumbers, Paragraph, placeholdersIn, RawEdit, sectionParagraphs, sentencesOf, summarize, SupportSource, unchangedIntegrity,
} from './rewriteChecks';

// Three versions of the text (A1 stage 3): the card for the population, the
// brief for business and journalists, the full text with point edits for the
// experts. Built from the document, the audience analysis of stage 2 (only the
// reference's verified fields, the groups' missing explanations and unclear
// terms) and, for the full text, the audit's verified High and Critical
// findings. Nothing of the audit, the persona scores or the audience analysis
// is changed. Every check is the code's (rewriteChecks.ts) and only marks.

/** Which groups each version is written for. Journalists are among the experts. */
const LAYER_GROUPS: Record<RewriteLayer, PersonaGroupKey[]> = {
  card: ['population'],
  brief: ['business', 'experts'],
  full: ['experts'],
};

async function loadInputs(projectId: number) {
  const project = await projectRepository.findById(projectId);
  if (!project) throw new NotFoundError(`Project ${projectId} not found`);
  const documentText = project.documentText ?? '';
  if (!documentText) throw new BadRequestError('У проекта нет документа');
  const audience = await audienceAnalysisService.get(projectId);
  if (!audience.analysis) throw new ConflictError('Сначала запустите анализ «Кому понятен текст»');
  const rows = await sectionsFor(projectId, documentText);
  const sections = rows.map((s, i) => ({ n: i + 1, order: s.order, title: sectionTitle(s.order, s.heading), text: s.text, start: s.startOffset }));
  const analytics = await analyticsService.getAnalytics(projectId);
  // Only verified quotes, only High and Critical (brief of 04.11.2026).
  const issues = (analytics.issues ?? []).filter((i) =>
    (i.severity === 'High' || i.severity === 'Critical') && i.quoteVerified === true && (i.kind ?? 'finding') === 'finding');
  return {
    project, documentText, sections, issues,
    analysis: audience.analysis,
    basedOn: audience.analysis.createdAt,
    reference: audience.analysis.reference.verified === true ? audience.analysis.reference : null,
    docNumbers: documentNumbers(documentText),
    // Where a basis must be verbatim, and the sections that back it.
    support: { quoteText: textForQuotes(documentText), sections: sections.map((s) => s.text), minCoverage: SUPPORT_MIN_COVERAGE, authorCheckBelow: AUTHOR_CHECK_BASIS_COVERAGE } as SupportSource,
    terms: audience.terms,
  };
}
type Inputs = Awaited<ReturnType<typeof loadInputs>>;

/** The reference as the prompt gets it: the sentence and only the verified fields. */
function decisionText(ref: DecisionReference | null): string | null {
  if (!ref) return null;
  const lines = [`Предложение решения: «${ref.quote}»`];
  if (ref.actor.value) lines.push(`Кто принял: ${ACTOR_LABELS[ref.actor.value as keyof typeof ACTOR_LABELS]} — «${ref.actor.quote}»`);
  if (ref.direction.value) lines.push(`Направление: ${DIRECTION_LABELS[ref.direction.value as keyof typeof DIRECTION_LABELS]} — «${ref.direction.quote}»`);
  if (ref.value.value !== null) lines.push(`Величина: ${String(ref.value.value).replace('.', ',')} — «${ref.value.quote}»`);
  return lines.join('\n');
}

function missingFor(inp: Inputs, layer: RewriteLayer): (RewriteMissingInput & { sections: string[] })[] {
  let k = 0;
  return LAYER_GROUPS[layer].flatMap((g) => (inp.analysis.missing[g]?.items ?? []).map((it) => ({
    id: `N${++k}`, missing: it.missing, question: it.question, suggestion: it.suggestion, sections: it.sections,
  })));
}

function contextFor(inp: Inputs, layer: RewriteLayer): RewriteContext {
  return {
    sections: inp.sections.map((s) => ({ n: s.n, title: s.title, text: s.text })),
    decision: decisionText(inp.reference),
    intended: inp.project.intendedMessages,
    missing: missingFor(inp, layer),
    terms: [...new Set(LAYER_GROUPS[layer].flatMap((g) => inp.terms[g]?.terms.map((t) => t.term) ?? []))],
  };
}

const meta = (inp: Inputs, version: string) => ({ status: 'ok' as const, failReason: '', version, basedOn: inp.basedOn, generatedAt: new Date().toISOString() });
const failed = (inp: Inputs, version: string, reason: string) => ({ ...meta(inp, version), status: 'failed' as const, failReason: reason });
const items = (raw: RewriteItemRaw[], ctx: ItemContext) => raw.map((r) => checkItem(r, ctx));
const joined = (xs: { text: string }[]) => xs.map((x) => x.text).join(' ');

async function makeCard(inp: Inputs): Promise<CardLayer> {
  const r = await generateCard(contextFor(inp, 'card'));
  if (!r.ok) return CardLayerSchema.parse(failed(inp, REWRITE_CARD_VERSION, r.reason));
  const ctx = CARD_CONTEXT(inp.docNumbers, inp.support);
  const parts = { decision: items(r.value.decision, ctx), why: items(r.value.why, ctx), forYou: items(r.value.forYou, ctx), next: items(r.value.next, ctx) };
  return CardLayerSchema.parse({
    ...meta(inp, REWRITE_CARD_VERSION),
    ...parts,
    decisionCheck: checkDecision(joined(parts.decision), inp.reference),
    summary: summarize([...parts.decision, ...parts.why, ...parts.forYou, ...parts.next], CARD_CHARS),
  });
}

async function makeBrief(inp: Inputs): Promise<BriefLayer> {
  const r = await generateBrief(contextFor(inp, 'brief'));
  if (!r.ok) return BriefLayerSchema.parse(failed(inp, REWRITE_BRIEF_VERSION, r.reason));
  const ctx = BRIEF_CONTEXT(inp.docNumbers, inp.support);
  const parts = { main: items(r.value.main, ctx), why: items(r.value.why, ctx), forBusiness: items(r.value.forBusiness, ctx), next: items(r.value.next, ctx) };
  const figures = r.value.figures.map((f) => ({ ...f, numbers: missingNumbers(f.value, inp.docNumbers) }));
  const all = [...parts.main, ...parts.why, ...parts.forBusiness, ...parts.next];
  const summary = summarize(all, BRIEF_CHARS);
  // The figures are part of the text: their volume and their numbers count.
  const figuresText = figures.map((f) => `${f.indicator}: ${f.value}`).join(' ');
  const chars = summary.chars + (figuresText ? figuresText.length + 1 : 0);
  return BriefLayerSchema.parse({
    ...meta(inp, REWRITE_BRIEF_VERSION),
    ...parts,
    figures,
    decisionCheck: checkDecision(joined(parts.main), inp.reference),
    summary: {
      ...summary,
      chars,
      withinVolume: chars >= BRIEF_CHARS.min && chars <= BRIEF_CHARS.max,
      numbersNotFound: summary.numbersNotFound + figures.reduce((a, f) => a + f.numbers.length, 0),
      marks: summary.marks + figures.filter((f) => f.numbers.length > 0).length,
    },
  });
}

async function makeFull(inp: Inputs): Promise<FullLayer> {
  const missing = missingFor(inp, 'full');
  const paragraphsBySection = inp.sections.map((s) => sectionParagraphs(s.order, s.text, s.start));
  // An issue goes to its section: by the section title, else by where its quote is.
  const issueSection = (i: Inputs['issues'][number]) => {
    const byTitle = inp.sections.findIndex((s) => s.title === i.section);
    if (byTitle >= 0) return byTitle;
    return inp.sections.findIndex((s) => !!i.quote && isVerbatimQuote(i.quote, s.text));
  };
  const issues = inp.issues.map((i) => ({ id: i.code, severity: i.severity, title: i.title, quote: i.quote ?? '', section: i.section ?? '', at: issueSection(i) }));

  const [blufRes, sectionResults] = await Promise.all([
    generateBluf(contextFor(inp, 'full')),
    mapLimit(inp.sections, REWRITE_SECTION_CONCURRENCY, async (s, idx) => {
      const own = issues.filter((i) => i.at === idx);
      // A missing explanation goes to the sections it names; one naming none, to every section.
      const ownMissing = missing.filter((m) => m.sections.length === 0 || m.sections.includes(s.title));
      if (own.length === 0 && ownMissing.length === 0) return { ok: true as const, value: [] as RawEdit[], skipped: true };
      const r = await generateSectionEdits({
        title: s.title,
        paragraphs: paragraphsBySection[idx]!.map((p) => ({ id: p.id, text: p.text })),
        issues: own,
        missing: ownMissing,
      });
      return r.ok ? { ok: true as const, value: r.value, skipped: false } : { ok: false as const, reason: r.reason, skipped: false };
    }),
  ]);

  const editCtx: EditContext = {
    issueIds: new Set(issues.map((i) => i.id)),
    missingIds: new Set(missing.map((m) => m.id)),
    docNumbers: inp.docNumbers,
    support: inp.support,
    // A dictionary term, and the definition names it.
    isTerm: (term, text) => { const c = canonicalOf(term); return !!c && termOccurrences(text).some((o) => o.canonical === c); },
  };
  const dropped = { unknownParagraph: 0, noLink: 0, duplicate: 0, newContent: 0 };
  const appliedBySection: ReturnType<typeof applyEdits>['paragraphs'][] = [];
  let applied = 0;
  const sectionsFailed: { order: number; title: string; reason: string }[] = [];
  const paragraphs = inp.sections.flatMap((s, idx) => {
    const res = sectionResults[idx]!;
    const source: Paragraph[] = paragraphsBySection[idx]!;
    if (!res.ok) {
      sectionsFailed.push({ order: s.order, title: s.title, reason: res.reason });
      appliedBySection[idx] = applyEdits(source, [], editCtx).paragraphs;
      return appliedBySection[idx]!;
    }
    const a = applyEdits(source, res.value, editCtx);
    appliedBySection[idx] = a.paragraphs;
    applied += a.applied;
    dropped.unknownParagraph += a.dropped.unknownParagraph;
    dropped.noLink += a.dropped.noLink;
    dropped.duplicate += a.dropped.duplicate;
    dropped.newContent += a.dropped.newContent;
    if (a.error) sectionsFailed.push({ order: s.order, title: s.title, reason: a.error });
    return a.paragraphs;
  });

  const blufItems = blufRes.ok ? items(blufRes.value, BRIEF_CONTEXT(inp.docNumbers, inp.support)) : [];
  const firstSentence = sentencesOf(joined(blufItems))[0] ?? '';
  const changedOrAdded = paragraphs.filter((p) => p.status !== 'same');
  const fullText = [joined(blufItems), ...paragraphs.map((p) => p.text)].join('\n\n');
  return FullLayerSchema.parse({
    ...meta(inp, `${REWRITE_SECTION_VERSION}; ${REWRITE_BLUF_VERSION}`),
    ...(blufRes.ok ? {} : { failReason: `«Главное»: ${blufRes.reason}` }),
    bluf: blufItems,
    blufDecision: blufItems.length ? checkDecision(firstSentence, inp.reference) : null,
    paragraphs,
    issues: issues.map((i) => ({
      id: i.id, severity: i.severity, title: i.title, section: i.section,
      status: i.at < 0 ? (paragraphs.some((p) => p.status !== 'same' && p.issueId === i.id) ? 'wrong_paragraph' : 'no_edit')
        : issueStatus(i.quote, paragraphsBySection[i.at]!, appliedBySection[i.at] ?? [], i.id),
    })),
    edits: { applied, dropped },
    sectionsFailed,
    integrity: unchangedIntegrity(paragraphs, inp.documentText, paragraphsBySection.flat()),
    summary: {
      chars: fullText.length,
      placeholders: [...blufItems.flatMap((i) => placeholdersIn(i.text)), ...changedOrAdded.flatMap((p) => p.checks?.placeholders ?? [])],
      numbersNotFound: blufItems.reduce((a, i) => a + i.checks.numbers.length, 0) + changedOrAdded.reduce((a, p) => a + (p.checks?.numbers.length ?? 0), 0),
      unsupported: blufItems.filter((i) => i.checks.support?.ok === false).length,
      authorChecks: blufItems.filter((i) => i.checks.support?.authorCheck).length + changedOrAdded.filter((p) => p.checks?.authorCheck).length,
      mustBePlaceholder: blufItems.filter((i) => i.checks.mustBePlaceholder).length + changedOrAdded.filter((p) => p.checks?.mustBePlaceholder).length,
      changed: paragraphs.filter((p) => p.status === 'changed').length,
      added: paragraphs.filter((p) => p.status === 'added').length,
    },
  });
}

const MAKERS = { card: makeCard, brief: makeBrief, full: makeFull } as const;

const guarded = singleFlight((projectId) => `Rewrites are already running for project ${projectId}`);

export const rewriteService = {
  /** All three versions; replaces the set whole. */
  async run(projectId: number): Promise<RewritesDTO> {
    return guarded(projectId, async () => {
      const inp = await loadInputs(projectId);
      await assertDailyBudget();
      const [card, brief, full] = await withUsageContext({ projectId }, () => Promise.all([makeCard(inp), makeBrief(inp), makeFull(inp)]));
      await rewriteRepository.replaceAll(projectId, { card, brief, full });
      return rewriteService.get(projectId);
    });
  },

  /** One version; the other two stay as they are. */
  async runLayer(projectId: number, layer: RewriteLayer): Promise<RewritesDTO> {
    return guarded(projectId, async () => {
      const inp = await loadInputs(projectId);
      await assertDailyBudget();
      const make = MAKERS[layer] as (i: Inputs) => Promise<CardLayer | BriefLayer | FullLayer>;
      const value = await withUsageContext({ projectId }, () => make(inp));
      await rewriteRepository.setLayer(projectId, layer, value);
      return rewriteService.get(projectId);
    });
  },

  async get(projectId: number): Promise<RewritesDTO> {
    const project = await projectRepository.findById(projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const [row, audience] = await Promise.all([rewriteRepository.find(projectId), audienceAnalysisService.get(projectId)]);
    const analysisAt = audience.analysis?.createdAt ?? null;
    // A damaged blob reads as no version, not as a failed page.
    const read = <S extends typeof CardLayerSchema | typeof BriefLayerSchema | typeof FullLayerSchema>(schema: S, v: unknown) => {
      if (v === null || v === undefined) return null;
      const p = schema.safeParse(v);
      return p.success ? p.data : null;
    };
    const layers: RewriteLayers = {
      card: read(CardLayerSchema, row?.card) as CardLayer | null,
      brief: read(BriefLayerSchema, row?.brief) as BriefLayer | null,
      full: read(FullLayerSchema, row?.full) as FullLayer | null,
    };
    const stale = (l: { basedOn: string } | null) => (l ? l.basedOn !== analysisAt : false);
    return {
      hasAnalysis: !!audience.analysis,
      analysisAt,
      document: { title: project.title, docType: project.docType ?? null, publishedAt: project.publishedAt ? project.publishedAt.toISOString().slice(0, 10) : null },
      bounds: { card: CARD_CHARS, brief: BRIEF_CHARS },
      card: layers.card ? { ...layers.card, stale: stale(layers.card) } : null,
      brief: layers.brief ? { ...layers.brief, stale: stale(layers.brief) } : null,
      full: layers.full ? { ...layers.full, stale: stale(layers.full) } : null,
    };
  },
};

export interface RewritesDTO {
  hasAnalysis: boolean;
  analysisAt:  string | null;
  document:    { title: string; docType: string | null; publishedAt: string | null };
  bounds:      { card: { min: number; max: number }; brief: { min: number; max: number } };
  card:  (CardLayer & { stale: boolean }) | null;
  brief: (BriefLayer & { stale: boolean }) | null;
  full:  (FullLayer & { stale: boolean }) | null;
}
