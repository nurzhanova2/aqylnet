import { env } from '../config/env';
import { PERSONA_SCORE_CONCURRENCY, PERSONA_SCORE_VERSION } from '../config/limits';
import { SCORING_CRITERIA, termsScore } from '../config/scoringScale';
import { projectRepository } from '../repositories/project.repository';
import { personaScoreRepository } from '../repositories/personaScore.repository';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { mapLimit } from '../utils/mapLimit';
import { singleFlight } from '../utils/singleFlight';
import {
  PersonaReadingRow, PersonaReadingRowSchema, PersonaSectionScoreRow, PersonaSectionScoreRowSchema,
} from '../validators/personaScore.validator';
import { textForQuotes } from './auditQuoteRules';
import { sectionsFor } from './documentSection.service';
import { findTerms, splitUnclear, termDensity } from './jargon';
import { buildPersonaScorePrompt, generatePersonaScore, PERSONA_CRITERION_KEYS, sectionTitle } from './llm.service';
import { assertDailyBudget, withUsageContext } from './llmUsage.service';
import {
  CellStats, documentCell, Divergence, Group, notUnderstoodShares, personaDocumentScore, sectionCell,
  sectionUnanswered, Shares, STAT_CRITERIA, StatCriterion, StatPersona, topDivergences,
} from './personaScoreStats';
import { estimateTokens, inputBudget } from './promptBudget';
import { isVerbatimQuote } from './promptSafety';

// Persona scores (A1 stage 1): every persona of the project scores the
// document section by section, independently — before and apart from the
// discussion, which this service never reads. The audit is untouched: this is
// a separate input (the personas' reading) and a separate output.

// Two runs of one project at once would each delete the other's rows. Checked
// in process before any call is made — the run is minutes of LLM time.
const scoreFlight = singleFlight((projectId) => `Persona scoring is already running for project ${projectId}`);

type ProjectRow = NonNullable<Awaited<ReturnType<typeof projectRepository.findById>>>;
type ProjectPersonaRow = ProjectRow['personas'][number];

/**
 * The persona as it scores: its LIBRARY profile, without the project's
 * overrides (decision of 03.11.2026). The overrides are the positions computed
 * from the document at project creation; a persona added later has none, so
 * with them some personas read with a prepared position and some without.
 * Identical conditions for everyone.
 */
function scoringPersona(pp: ProjectPersonaRow) {
  return pp.persona;
}

type Leveled = { value: number | null; level: number | null; why: string; adjusted: boolean; reason?: string };

/** { key: reason } for the null ones, { key: { level, why, adjusted } } for the rest. */
function splitLeveled(scores: Partial<Record<string, Leveled>>) {
  const nullReasons: Record<string, string> = {};
  const levels: Record<string, { level: number | null; why: string; adjusted: boolean }> = {};
  for (const [k, v] of Object.entries(scores)) {
    if (!v) continue;
    if (v.value === null && v.reason) nullReasons[k] = v.reason;
    if (v.level !== null || v.why) levels[k] = { level: v.level, why: v.why, adjusted: v.adjusted };
  }
  return { nullReasons, levels };
}

export const personaScoreService = {
  async run(projectId: number): Promise<PersonaScoresDTO> {
    return scoreFlight(projectId, () => personaScoreService._run(projectId));
  },

  async _run(projectId: number): Promise<PersonaScoresDTO> {
    const project = await projectRepository.findById(projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const documentText = project.documentText ?? '';
    if (!documentText) throw new BadRequestError('У проекта нет документа — оценивать нечего');
    if (project.personas.length === 0) throw new BadRequestError('В проекте нет участников');

    const sections = await sectionsFor(projectId, documentText);
    const found = sections.map((s) => findTerms(s.text).map((t) => t.canonical));
    const inputs = sections.map((s, i) => ({ n: i + 1, title: sectionTitle(s.order, s.heading), terms: found[i]! }));

    // The whole document goes to every persona. The attach-time limit is
    // sized for a persona's reply, not for this answer, so the window is
    // checked again for this scenario's budget — before anything is spent.
    const probe = buildPersonaScorePrompt(scoringPersona(project.personas[0]!), documentText, inputs, 'x'.repeat(16));
    if (estimateTokens([probe.system, probe.user]) > inputBudget(env.llm.maxTokens.personaScore)) {
      throw new BadRequestError('Документ слишком длинный для оценки участниками: он не помещается в окно модели вместе с ответом по всем разделам');
    }

    // One check for the request, not per persona (see assertDailyBudget).
    await assertDailyBudget();
    const results = await withUsageContext({ projectId }, () =>
      mapLimit(project.personas, PERSONA_SCORE_CONCURRENCY, (pp) => generatePersonaScore(scoringPersona(pp), documentText, inputs)));

    const quoteText = textForQuotes(documentText);
    const scores: PersonaSectionScoreRow[] = [];
    const readings: PersonaReadingRow[] = [];
    project.personas.forEach((pp, i) => {
      const r = results[i]!;
      const personaId = pp.persona.id;
      if (!r.ok) {
        readings.push(PersonaReadingRowSchema.parse({
          projectId, personaId, status: 'failed', failReason: r.reason,
          mainTakeaway: '', decision: '', myAction: '', extraUnclearWords: [],
          rateSignal: null, levels: {},
        }));
        return;
      }
      const extra = new Set<string>();
      r.sections.forEach((a, j) => {
        const section = sections[j]!;
        const { terms, others } = splitUnclear(a.unclearTerms, found[j]!);
        others.forEach((w) => extra.add(w));
        const { nullReasons, levels } = splitLeveled(a.scores);
        scores.push(PersonaSectionScoreRowSchema.parse({
          projectId, personaId, sectionId: section.id,
          clarity: a.scores.clarity?.value ?? null,
          reasons: a.scores.reasons?.value ?? null,
          myAction: a.scores.myAction?.value ?? null,
          // Criterion 4 is scored once per document since @3.
          rateSignal: null,
          trust: a.scores.trust?.value ?? null,
          nullReasons,
          levels,
          terms: termsScore(found[j]!.length, terms.length),
          termsFound: found[j]!,
          termsUnclear: terms,
          skipped: a.skipped,
          read: a.read,
          unclear: a.unclear,
          quote: a.quote,
          quoteHelped: a.quoteHelped,
          // Checked against the text without running headers and footers,
          // as the audit does. null = no quote to check.
          quoteVerified: a.quote ? isVerbatimQuote(a.quote, quoteText) : null,
        }));
      });
      const doc = splitLeveled(r.document);
      readings.push(PersonaReadingRowSchema.parse({
        projectId, personaId, status: 'scored', failReason: '',
        mainTakeaway: r.mainTakeaway, decision: r.decision, myAction: r.myAction,
        extraUnclearWords: [...extra].slice(0, 50),
        rateSignal: r.document.rateSignal?.value ?? null,
        // Every document criterion gets an entry — a null one with its reason,
        // so an answer cut before its document block says so.
        levels: Object.fromEntries(Object.entries(r.document).map(([k, v]) => [k, {
          level: v?.level ?? null, why: v?.why ?? '', adjusted: v?.adjusted ?? false, reason: v?.value === null ? (v?.reason ?? 'не указано') : '',
        }])),
      }));
    });

    await personaScoreRepository.replaceForProject(projectId, scores, readings);
    return personaScoreService.get(projectId);
  },

  async get(projectId: number): Promise<PersonaScoresDTO> {
    const project = await projectRepository.findById(projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const documentText = project.documentText ?? '';
    const sectionRows = documentText ? await sectionsFor(projectId, documentText) : [];
    const [scores, readings] = await Promise.all([
      personaScoreRepository.findScores(projectId),
      personaScoreRepository.findReadings(projectId),
    ]);

    const sections = sectionRows.map((s) => ({
      id: s.id,
      order: s.order,
      title: sectionTitle(s.order, s.heading),
      length: s.text.length,
      terms: findTerms(s.text).map((t) => t.canonical),
      density: termDensity(s.text),
    }));
    const orderOf = new Map(sectionRows.map((s) => [s.id, s.order]));

    const personas: PersonaScoreDTO[] = readings.map((rd) => {
      const own = scores.filter((s) => s.personaId === rd.personaId);
      const sectionAnswers = own.map((s) => ({
        sectionId: s.sectionId,
        order: orderOf.get(s.sectionId) ?? -1,
        skipped: s.skipped,
        scores: { clarity: s.clarity, reasons: s.reasons, myAction: s.myAction, rateSignal: s.rateSignal, trust: s.trust, terms: s.terms },
        nullReasons: (s.nullReasons ?? {}) as Record<string, string>,
        levels: (s.levels ?? {}) as Record<string, { level: number | null; why: string; adjusted: boolean }>,
        read: s.read,
        unclear: s.unclear,
        termsFound: s.termsFound,
        termsUnclear: s.termsUnclear,
        quote: s.quote,
        quoteHelped: s.quoteHelped,
        quoteVerified: s.quoteVerified,
      })).sort((a, b) => a.order - b.order);
      return {
        id: rd.persona.id,
        name: rd.persona.name,
        role: rd.persona.role,
        group: rd.persona.group,
        avatarIdx: rd.persona.avatarIdx,
        dot: rd.persona.dot,
        gender: rd.persona.gender,
        look: rd.persona.look,
        status: rd.status as 'scored' | 'failed',
        failReason: rd.failReason,
        mainTakeaway: rd.mainTakeaway,
        decision: rd.decision,
        myAction: rd.myAction,
        extraUnclearWords: rd.extraUnclearWords,
        documentLevels: (rd.levels ?? {}) as Record<string, { level: number | null; why: string; adjusted: boolean; reason?: string }>,
        rateSignal: rd.rateSignal,
        document: {} as Record<StatCriterion, number | null>,
        sections: sectionAnswers,
      };
    });

    const stat: StatPersona[] = personas.map((p) => ({
      personaId: p.id,
      group: p.group,
      scored: p.status === 'scored',
      decision: p.decision,
      myAction: p.myAction,
      sections: p.sections.map((s) => ({ order: s.order, scores: s.scores, quote: s.quote, quoteVerified: s.quoteVerified, quoteHelped: s.quoteHelped, unclear: s.skipped ? 0 : s.unclear.length })),
      // Scored once per document (persona_score@3).
      documentScores: { rateSignal: p.rateSignal },
    }));
    const statSections = sections.map((s) => ({ order: s.order, length: s.length }));
    for (const p of personas) {
      const sp = stat.find((x) => x.personaId === p.id)!;
      for (const k of STAT_CRITERIA) p.document[k] = sp.scored ? personaDocumentScore(sp, statSections, k) : null;
    }

    const document = Object.fromEntries(STAT_CRITERIA.map((k) => [k, documentCell(stat, statSections, k)])) as Record<StatCriterion, CellStats>;
    const bySection = sections.map((s) => ({
      order: s.order,
      cells: Object.fromEntries(STAT_CRITERIA.map((k) => [k, sectionCell(stat, s.order, k)])) as Record<StatCriterion, CellStats>,
      unanswered: sectionUnanswered(stat, s.order),
    }));
    const quoted = personas.flatMap((p) => p.sections).filter((s) => s.quote);

    return {
      hasScores: readings.length > 0,
      version: PERSONA_SCORE_VERSION,
      scoredAt: readings[0]?.createdAt?.toISOString() ?? null,
      criteria: SCORING_CRITERIA.map((c) => ({ key: c.key, n: c.n, label: c.label, levels: c.levels, computed: c.computed, mayBeInapplicable: c.mayBeInapplicable, documentLevel: !!c.documentLevel })),
      personaCriteria: [...PERSONA_CRITERION_KEYS],
      sections,
      personas,
      stats: {
        document,
        sections: bySection,
        top: topDivergences(stat, statSections, 5),
        // Criterion 6 apart: computed by code, a different range (see
        // PERSONA_STAT_CRITERIA).
        topTerms: topDivergences(stat, statSections, 1, ['terms'])[0] ?? null,
        shares: notUnderstoodShares(stat),
        unanswered: bySection.reduce((a, s) => a + s.unanswered.total, 0),
        quotes: { total: quoted.length, verified: quoted.filter((s) => s.quoteVerified === true).length },
      },
    };
  },
};

export interface PersonaScoreDTO {
  id: number;
  name: string;
  role: string;
  group: Group | null;
  avatarIdx: number;
  dot: string;
  gender: string;
  look: unknown;
  status: 'scored' | 'failed';
  failReason: string;
  mainTakeaway: string;
  decision: string;
  myAction: string;
  extraUnclearWords: string[];
  /** Document-level criteria (4): level, phrase, band adjustment, null reason. */
  documentLevels: Record<string, { level: number | null; why: string; adjusted: boolean; reason?: string }>;
  rateSignal: number | null;
  /** The persona's document score per criterion (sections weighted by length). */
  document: Record<StatCriterion, number | null>;
  sections: {
    sectionId: number;
    order: number;
    skipped: boolean;
    scores: Record<StatCriterion, number | null>;
    nullReasons: Record<string, string>;
    levels: Record<string, { level: number | null; why: string; adjusted: boolean }>;
    read: string;
    unclear: string[];
    termsFound: string[];
    termsUnclear: string[];
    quote: string;
    quoteHelped: boolean | null;
    quoteVerified: boolean | null;
  }[];
}

export interface PersonaScoresDTO {
  hasScores: boolean;
  version: string;
  scoredAt: string | null;
  criteria: { key: string; n: number; label: string; levels: Record<number, string>; computed: boolean; mayBeInapplicable: boolean; documentLevel: boolean }[];
  personaCriteria: string[];
  sections: { id: number; order: number; title: string; length: number; terms: string[]; density: number }[];
  personas: PersonaScoreDTO[];
  stats: {
    document: Record<StatCriterion, CellStats>;
    sections: { order: number; cells: Record<StatCriterion, CellStats>; unanswered: { total: number; mean: number | null } }[];
    /** Questions the document left unanswered, summed over sections and personas. */
    unanswered: number;
    top: Divergence[];
    /** The largest divergence on criterion 6 (terms), shown on its own line. */
    topTerms: Divergence | null;
    shares: Shares;
    quotes: { total: number; verified: number };
  };
}
