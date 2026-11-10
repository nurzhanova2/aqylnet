import { env } from '../config/env';
import {
  DECISION_REFERENCE_VERSION, DECISION_VERDICT_VERSION, MAX_GROUP_TERMS, MISSING_EXPLANATIONS_VERSION,
} from '../config/limits';
import { GROUP_LABELS, PERSONA_GROUPS, PersonaGroupKey } from '../config/personaGroups';
import { projectRepository } from '../repositories/project.repository';
import { audienceAnalysisRepository } from '../repositories/audienceAnalysis.repository';
import { BadRequestError, ConflictError, NotFoundError } from '../utils/errors';
import { singleFlight } from '../utils/singleFlight';
import {
  AudienceAnalysisRowSchema, DecisionReference, DecisionReferenceSchema, GroupMissing, GroupMissingSchema,
  PersonaVerdict, PersonaVerdictSchema,
} from '../validators/audienceAnalysis.validator';
import { z } from 'zod';
import { textForQuotes } from './auditQuoteRules';
import {
  applyVerdicts, checkReference, groupMaterial, planVerdicts, resolveMissing, verdictsWithoutReference,
} from './audienceRules';
import {
  AudienceGap, AudiencePersona, audienceGap, groupTerms, GroupTerms, GroupUnderstanding, groupUnderstanding,
  understandingPhrase,
} from './audienceStats';
import {
  buildDecisionReferencePrompt, DecisionVerdict, extractDecisions, generateDecisionReference,
  generateMissingExplanations,
} from './llm.service';
import { assertDailyBudget, withUsageContext } from './llmUsage.service';
import { personaScoreService, PersonaScoreDTO, PersonaScoresDTO } from './personaScore.service';
import { estimateTokens, inputBudget } from './promptBudget';

// For whom the text is clear (A1 stage 2). Built on the persona scores of
// stage 1, read through personaScoreService.get — the same DTO the report
// shows. Neither the scores, the audit nor the discussion is changed.
//
// POST runs the model's part: the decision reference, the verdicts on the
// personas' decision answers, the missing explanations per group (up to five
// calls). GET computes the rest on every read, by code: group levels, the
// gap against the intended audience, the unclear terms per group.

const audienceFlight = singleFlight((projectId) => `Audience analysis is already running for project ${projectId}`);

function sectionTitleOf(scores: PersonaScoresDTO) {
  const byOrder = new Map(scores.sections.map((s) => [s.order, s.title]));
  return (order: number) => byOrder.get(order) ?? `Раздел ${order + 1}`;
}

export const audienceAnalysisService = {
  async run(projectId: number): Promise<AudienceAnalysisDTO> {
    return audienceFlight(projectId, () => audienceAnalysisService._run(projectId));
  },

  async _run(projectId: number): Promise<AudienceAnalysisDTO> {
    const project = await projectRepository.findById(projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const scores = await personaScoreService.get(projectId);
    const scored = scores.personas.filter((p) => p.status === 'scored');
    if (!scores.hasScores || scored.length === 0 || !scores.scoredAt) {
      throw new ConflictError('Сначала запустите оценки участников');
    }
    const documentText = project.documentText ?? '';
    if (!documentText) throw new BadRequestError('У проекта нет документа');

    const outline = scores.sections.map((s) => s.title);
    const hint = project.intendedMessages[0] ?? null;
    const probe = buildDecisionReferencePrompt(documentText, outline, hint, 'x'.repeat(16));
    if (estimateTokens([probe.system, probe.user]) > inputBudget(env.llm.maxTokens.decisionReference)) {
      throw new BadRequestError('Документ слишком длинный для поиска решения: он не помещается в окно модели');
    }

    // One check for the request, not per call (see assertDailyBudget).
    await assertDailyBudget();
    const row = await withUsageContext({ projectId }, async () => {
      // 2.1 The reference.
      const raw = await generateDecisionReference(documentText, outline, hint);
      const reference = checkReference(raw, textForQuotes(documentText));

      // 2.2 The verdicts.
      let verdicts: PersonaVerdict[];
      if (reference.verified) {
        const plan = planVerdicts(scores.personas);
        // The model only extracts; the verdict is the code's.
        const extracted = plan.answers.length > 0 ? await extractDecisions(plan.answers) : new Map();
        verdicts = applyVerdicts(scores.personas, plan, extracted, reference);
      } else {
        verdicts = verdictsWithoutReference(scores.personas);
      }

      // 5.2 Missing explanations, one call per group with material.
      const byPersona = new Map(verdicts.map((v) => [v.personaId, v]));
      const title = sectionTitleOf(scores);
      const missingEntries = await Promise.all(PERSONA_GROUPS.map(async (g): Promise<[PersonaGroupKey, GroupMissing]> => {
        const ps = scored.filter((p) => p.group === g);
        const empty = { items: [], returned: 0, dropped: 0, droppedBy: { noSource: 0, noWords: 0, onePersona: 0 }, unknownIds: 0 };
        if (ps.length === 0) return [g, { status: 'insufficient', reason: 'недостаточно данных: нет участников группы', ...empty }];
        const material = groupMaterial(ps, byPersona, title);
        if (material.length === 0) return [g, { status: 'insufficient', reason: 'недостаточно данных: у участников нет вопросов и низких оценок', ...empty }];
        const answer = await generateMissingExplanations(GROUP_LABELS[g].nom, material, ps.length);
        if (answer === null) return [g, { status: 'failed', reason: 'вызов модели не дал результата', ...empty }];
        return [g, { status: 'ok', reason: '', ...resolveMissing(answer, material, outline) }];
      }));

      return AudienceAnalysisRowSchema.parse({
        projectId,
        scoresAt: new Date(scores.scoredAt!),
        reference,
        verdicts,
        missing: Object.fromEntries(missingEntries),
        versions: {
          reference: DECISION_REFERENCE_VERSION,
          verdicts: DECISION_VERDICT_VERSION,
          missing: MISSING_EXPLANATIONS_VERSION,
        },
      });
    });

    await audienceAnalysisRepository.replaceForProject(row);
    return audienceAnalysisService.get(projectId);
  },

  async get(projectId: number): Promise<AudienceAnalysisDTO> {
    const project = await projectRepository.findById(projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    const [scores, stored] = await Promise.all([
      personaScoreService.get(projectId),
      audienceAnalysisRepository.find(projectId),
    ]);

    // A damaged blob reads as no analysis, not as a failed page — as extras.
    const reference = stored ? DecisionReferenceSchema.safeParse(stored.reference) : null;
    const verdictList = stored ? z.array(PersonaVerdictSchema).safeParse(stored.verdicts) : null;
    const missing = stored ? z.record(z.string(), GroupMissingSchema).safeParse(stored.missing) : null;
    const analysisOk = !!(stored && reference?.success && verdictList?.success && missing?.success);
    const verdicts = new Map((analysisOk ? verdictList!.data! : []).map((v) => [v.personaId, v]));

    const personas: AudiencePersona[] = scores.personas.map((p) => ({
      personaId: p.id,
      group: p.group,
      scored: p.status === 'scored',
      document: { clarity: p.document.clarity ?? null, myAction: p.document.myAction ?? null, terms: p.document.terms ?? null },
      unanswered: p.sections.reduce((a, s) => a + (s.skipped ? 0 : s.unclear.length), 0),
      verdict: (verdicts.get(p.id)?.verdict ?? null) as DecisionVerdict | null,
      termsUnclear: [...new Set(p.sections.flatMap((s) => s.termsUnclear))],
      extraWords: p.extraUnclearWords,
    }));
    const groups = groupUnderstanding(personas);
    const intended = (project.intendedAudience ?? []) as PersonaGroupKey[];

    return {
      hasScores: scores.hasScores,
      scoresAt: scores.scoredAt,
      document: {
        docType: project.docType ?? null,
        publishedAt: project.publishedAt ? project.publishedAt.toISOString().slice(0, 10) : null,
        intendedAudience: intended,
      },
      groups,
      phrase: understandingPhrase(groups),
      gap: audienceGap(intended, groups),
      terms: Object.fromEntries(PERSONA_GROUPS.map((g) => [g, groupTerms(personas, g, MAX_GROUP_TERMS)])) as Record<PersonaGroupKey, GroupTerms>,
      analysis: analysisOk ? {
        createdAt: stored!.createdAt.toISOString(),
        basedOn: stored!.scoresAt.toISOString(),
        // Scores rerun after the analysis: shown as stale, never deleted.
        stale: !scores.scoredAt || stored!.scoresAt.toISOString() !== scores.scoredAt,
        reference: reference!.data!,
        verdicts: scores.personas.map((p) => ({
          personaId: p.id,
          name: p.name,
          group: p.group,
          decision: p.decision,
          verdict: verdicts.get(p.id)?.verdict ?? null,
          reason: verdicts.get(p.id)?.reason ?? 'персона добавлена после анализа',
          by: verdicts.get(p.id)?.by ?? 'code',
          extracted: verdicts.get(p.id)?.extracted ?? null,
        })),
        missing: missing!.data! as Partial<Record<PersonaGroupKey, GroupMissing>>,
        versions: (stored!.versions ?? {}) as Record<string, string>,
      } : null,
    };
  },
};

export interface AudienceAnalysisDTO {
  hasScores: boolean;
  scoresAt: string | null;
  document: { docType: string | null; publishedAt: string | null; intendedAudience: PersonaGroupKey[] };
  /** Computed by code on every read (п. 3). */
  groups: GroupUnderstanding[];
  phrase: string | null;
  /** null when no intended audience is set (п. 4). */
  gap: AudienceGap | null;
  /** п. 5.1, by code. */
  terms: Record<PersonaGroupKey, GroupTerms>;
  /** The model's part (пп. 2, 5.2); null until POST has run. */
  analysis: {
    createdAt: string;
    basedOn: string;
    stale: boolean;
    reference: DecisionReference;
    verdicts: {
      personaId: number;
      name: string;
      group: PersonaScoreDTO['group'];
      decision: string;
      verdict: DecisionVerdict | null;
      reason: string;
      by: 'model' | 'code';
      extracted: PersonaVerdict['extracted'];
    }[];
    missing: Partial<Record<PersonaGroupKey, GroupMissing>>;
    versions: Record<string, string>;
  } | null;
}
