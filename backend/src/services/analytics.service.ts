import { AnalyticsReport } from '@prisma/client';
import { analyticsRepository }  from '../repositories/analytics.repository';
import { projectRepository, ProjectPersonaFace, ProjectPersonaRow } from '../repositories/project.repository';
import { discussionRepository } from '../repositories/discussion.repository';
import { NotFoundError }        from '../utils/errors';
import { prisma }               from '../config/prisma';
import { computeOverallScore }  from './llm.service';
import { textForQuotes }        from './auditQuoteRules';
import { toTimelineDTO }        from './discussion.service';
import {
  collectDirectives,
  verifyAltParagraphs,
  verifyIssueQuotes,
  PersonaScanInput,
} from './reportTrust';
import {
  UpsertAnalyticsInput,
  AnalyticsExtrasSchema,
  AnalyticsExtras,
  AltParagraph,
  EMPTY_EXTRAS,
} from '../validators/analytics.validator';

// ─── DTO ─────────────────────────────────────────────────────
// One response covers all AnalyticsPage data needs.
// Field names match analytics.js mock imports exactly.

export interface AnalyticsReportDTO {
  hasReport:        boolean;
  // Project metadata (replaces hardcoded strings in AnalyticsPage)
  projectTitle:    string;
  projectSubtitle: string;
  // The model that actually answered last for this project (LlmUsage.model,
  // the name the proxy returned), else the one configured at creation. The
  // report's footer — what produced the analysis, not the alias.
  llmModel:        string | null;
  personaCount:    number;
  // The report shows the panel as faces, so it needs the personas themselves —
  // same minimal shape the projects list uses.
  personas:        ProjectPersonaFace[];
  iterations:      number;
  mode:            string;

  // Mood block (was hardcoded in AnalyticsPage, now from DiscussionSummary)
  mood:            string;
  moodEmoji:       string;
  moodDescription: string;

  // Analytics data (was imported from analytics.js)
  conclusions:     { n: number; text: string }[];
  topicBars:       { name: string; pct: number }[];
  risks:           string[];
  positives:       { text: string; by: string }[];
  recommendations: string[];
  altParagraphs:   AltParagraph[];

  // Document audit block (AnalyticsReport.extras) — flattened into the DTO so
  // AnalyticsPage reads scores/issues/sections like any other report field.
  overallScore:    number | null;
  scores:          AnalyticsExtras['scores'];
  issues:          AnalyticsExtras['issues'];
  sections:        AnalyticsExtras['sections'];
  alignment:       AnalyticsExtras['alignment'];
  // Stage E6: what the server found in the untrusted inputs and what it could
  // not confirm in the model's output. The page shows these, because a report
  // the reader cannot tell apart from a checked one is the actual risk here.
  directives:      AnalyticsExtras['directives'];
  trustChecked:    boolean;
}

// ─── Presenters ──────────────────────────────────────────────

async function lastModel(projectId: number, configured: string | null): Promise<string | null> {
  const row = await prisma.llmUsage.findFirst({ where: { projectId }, orderBy: { createdAt: 'desc' }, select: { model: true } });
  return row?.model ?? configured ?? null;
}


// extras is a free-form Json column that predates the audit block (older rows
// hold null), and a half-written blob must not break the page — parse through
// Zod and fall back to an empty audit.
function parseExtras(raw: unknown): AnalyticsExtras {
  if (!raw || typeof raw !== 'object') return EMPTY_EXTRAS;
  const parsed = AnalyticsExtrasSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_EXTRAS;
}

function reportFields(r: AnalyticsReport) {
  const extras = parseExtras(r.extras);
  return {
    conclusions:     r.conclusions     as { n: number; text: string }[],
    topicBars:       r.topicBars       as { name: string; pct: number }[],
    risks:           r.risks,
    positives:       r.positives       as { text: string; by: string }[],
    recommendations: r.recommendations,
    // Rows written before stage E6 have no `verified` key at all; normalise to
    // null (= "no claim checked") rather than leaving it undefined, so the page
    // has one shape to render and an old report does not look like a failed
    // check.
    altParagraphs:   (r.altParagraphs as AltParagraph[]).map((a) => ({
      ...a,
      verified: a.verified ?? null,
    })),
    overallScore:    extras.overallScore,
    scores:          extras.scores,
    issues:          extras.issues,
    sections:        extras.sections,
    alignment:       extras.alignment,
    directives:      extras.directives,
    trustChecked:    extras.trustChecked,
  };
}

const EMPTY_REPORT_FIELDS = {
  conclusions:     [] as { n: number; text: string }[],
  topicBars:       [] as { name: string; pct: number }[],
  risks:           [] as string[],
  positives:       [] as { text: string; by: string }[],
  recommendations: [] as string[],
  altParagraphs:   [] as AltParagraph[],
  overallScore:    null as number | null,
  scores:          [] as AnalyticsExtras['scores'],
  issues:          [] as AnalyticsExtras['issues'],
  sections:        [] as AnalyticsExtras['sections'],
  alignment:       [] as AnalyticsExtras['alignment'],
  directives:      [] as AnalyticsExtras['directives'],
  trustChecked:    false,
};

// The persona text that actually reaches a prompt, so the scan sees what the
// model saw: library fields with the per-project overrides applied in the same
// precedence buildPersonaSystemPrompt() is given them in.
//
// Every one of these is a free string in the database, writable by any client
// through PATCH /personas/:id — the library is shared by design and has no
// owner (SECURITY.md item 7 is an open product question) — and they are
// interpolated into a *system* message, which is the one place a model is most
// inclined to read as authority.
function personaScanInput(pp: ProjectPersonaRow): PersonaScanInput {
  const p = pp.persona;
  return {
    name: p.name,
    values: [
      p.role, p.city, p.education, p.industry, p.employerType, p.income,
      p.personalSituation, p.style, p.criticality, p.behaviorModel,
      p.openness, p.decisionMaking,
      pp.stanceOverride    || p.stance,
      pp.reasoningOverride || p.reasoning,
      pp.priorityOverride  || p.priority,
      pp.fearsOverride     || p.fears,
      pp.thinkingOverride  || p.thinking,
      ...p.interests,
      p.speechTone, p.argumentation, p.typicalPhrases,
    ],
  };
}

// ─── Service ─────────────────────────────────────────────────

export const analyticsService = {
  async getAnalytics(projectId: number): Promise<AnalyticsReportDTO> {
    // 1. Load project (validates existence + counts personas)
    const project = await projectRepository.findById(projectId);
    if (!project) throw new NotFoundError(`Project with id ${projectId} not found`);

    // 2. Load discussion summary for mood data (optional)
    const summary = await discussionRepository.findSummary(projectId);

    // 3. Load analytics report (may not exist yet)
    const report = await analyticsRepository.findByProjectId(projectId);

    return {
      hasReport:        Boolean(report),
      projectTitle:    project.title,
      llmModel:        await lastModel(projectId, project.llmModel),
      projectSubtitle: project.subtitle,
      personaCount:    project.personas.length,
      personas:        project.personas.map((pp) => pp.persona),
      iterations:      project.iterations,
      mode:            project.mode,

      mood:            summary?.mood        ?? 'Нейтральное',
      moodEmoji:       summary?.moodEmoji   ?? '😐',
      moodDescription: summary?.conclusion  ?? '',

      ...(report ? reportFields(report) : EMPTY_REPORT_FIELDS),
    };
  },

  async upsertAnalytics(
    projectId: number,
    input: UpsertAnalyticsInput,
  ): Promise<AnalyticsReportDTO> {
    const project = await projectRepository.findById(projectId);
    if (!project) throw new NotFoundError(`Project with id ${projectId} not found`);

    // The one place overallScore is produced. The request cannot carry it
    // (AnalyticsExtrasInputSchema omits the field and Zod strips it), so it is
    // always derived here from the axes and issues that were accepted — mean of
    // the axes, capped at 55 by a Critical issue and 75 by a High one, null
    // when there are no axes rather than a fabricated zero.
    //
    // report.service goes through this same method, so the value it stored
    // from generateDocumentAudit is recomputed from the same inputs and comes
    // out identical; there is no second formula to keep in step.
    //
    // Stage E6 puts the trust pass here for the same reason: this is the only
    // way into the column, so PUT /:id/analytics is verified on exactly the
    // same terms as a generated report, and neither can carry a verdict that
    // was not computed from the stored document.
    const documentText = project.documentText ?? '';
    // Quotes are checked against the text without running headers and
    // footers (auditQuoteRules.textForQuotes): a sentence across a page break
    // is otherwise never verbatim. Directives are looked for in the full text.
    const quoteText = textForQuotes(documentText);
    const issues = verifyIssueQuotes(input.extras.issues, quoteText);

    const rows = await discussionRepository.findTimeline(projectId);
    const messages = rows.map(toTimelineDTO).map((m) => ({ name: m.name, text: m.text }));

    const extras: AnalyticsExtras = {
      ...input.extras,
      issues,
      overallScore: computeOverallScore(input.extras.scores, issues),
      directives: collectDirectives({
        documentText,
        messages,
        personas: project.personas.map(personaScanInput),
      }),
      trustChecked: true,
    };

    const altParagraphs = verifyAltParagraphs(input.altParagraphs, quoteText);

    const report  = await analyticsRepository.upsert(projectId, { ...input, altParagraphs, extras });
    const summary = await discussionRepository.findSummary(projectId);

    return {
      hasReport:        true,
      projectTitle:    project.title,
      llmModel:        await lastModel(projectId, project.llmModel),
      projectSubtitle: project.subtitle,
      personaCount:    project.personas.length,
      personas:        project.personas.map((pp) => pp.persona),
      iterations:      project.iterations,
      mode:            project.mode,
      mood:            summary?.mood       ?? 'Нейтральное',
      moodEmoji:       summary?.moodEmoji  ?? '😐',
      moodDescription: summary?.conclusion ?? '',
      ...reportFields(report),
    };
  },
};
