import { projectRepository } from '../repositories/project.repository';
import { discussionService } from './discussion.service';
import { analyticsService, AnalyticsReportDTO } from './analytics.service';
import {
  generateDiscussionReport,
  buildDiscussionContext,
  GOAL_LABELS,
} from './llm.service';
import { runDocumentAudit } from './audit.service';
import { NotFoundError, BadRequestError } from '../utils/errors';
import { assertDailyBudget, withUsageContext } from './llmUsage.service';
import { singleFlight } from '../utils/singleFlight';
import { UpsertSummarySchema } from '../validators/discussion.validator';
import { UpsertAnalyticsSchema } from '../validators/analytics.validator';

// Цвета тегов альтернативной редакции — из палитры Graphite Green: амбровый
// для изменённого, акцент для добавленного, нейтральный для «без изм.».
// Хранятся в строке отчёта, поэтому меняют вид только новых отчётов; у старых
// остаются прежние значения, и это правильно — отчёт показывает то, с чем его
// сформировали.
const ALT_TAG_COLORS: Record<string, string> = {
  'без изм.': '#8d928f',
  'изменено': '#e3a948',
  'добавлено': '#4fb488',
};
const DEFAULT_ALT_COLOR = '#a48bff';

// One report generation per project at a time. Without it a double click, or
// the client retrying a gateway 504 while the first generation was still
// running, paid for the whole section-by-section audit twice.
const reportFlight = singleFlight((projectId) => `A report is already being generated for project ${projectId}`);

export const reportService = {
  async generateReport(projectId: number): Promise<AnalyticsReportDTO> {
    // The report call plus the section-by-section audit — ~9 section calls for
    // 15 pages, each carrying the transcript. Checked once for the request, not
    // per call: see assertDailyBudget.
    await assertDailyBudget();
    return reportFlight(projectId, () =>
      withUsageContext({ projectId }, () => reportService._generate(projectId)),
    );
  },

  async _generate(projectId: number): Promise<AnalyticsReportDTO> {
    const project = await projectRepository.findById(projectId);
    if (!project) throw new NotFoundError(`Project ${projectId} not found`);
    if (!project.documentText) throw new BadRequestError('Project has no document to analyze');

    const timeline = await discussionService.getTimeline(projectId);
    if (timeline.length === 0) throw new BadRequestError('Discussion has no messages yet');

    // Use the effective stance (per-discussion override, if any) — this is
    // what actually drove the persona's replies in iteration.service.ts, and
    // report.service.ts was silently reading the un-overridden library
    // default instead, out of sync with the real discussion.
    const personas = project.personas.map((pp) => ({
      name:  pp.persona.name,
      role:  pp.persona.role,
      stance: pp.stanceOverride || pp.persona.stance,
    }));

    const context  = buildDiscussionContext(project.documentText, project.subtitle);
    const speakers = timeline.map((m) => ({ speaker: m.name, text: m.text }));
    const goal     = GOAL_LABELS[project.goal] ?? project.goal;

    // Two independent passes, run together: the discussion report (mood, risks,
    // recommendations) and the document audit (scores, structured issues, the
    // section map, intended-vs-perceived). The audit is one call per stored
    // section; a failed section is marked "not analysed" rather than failing the
    // audit, so a bad section can't cost the report either.
    //
    // The audit takes the raw document rather than buildDiscussionContext()
    // output on purpose — the wrapper's task/jurisdiction preamble would
    // otherwise be audited as if it were part of the document.
    const [report, audit] = await Promise.all([
      generateDiscussionReport(context, personas, speakers, goal, project.intendedMessages),
      runDocumentAudit({
        projectId,
        documentText:     project.documentText,
        discussionTask:   project.subtitle,
        personas,
        timeline:         speakers,
        goal,
        intendedMessages: project.intendedMessages,
      }),
    ]);

    // The LLM's JSON output is only shape-checked by a TypeScript cast (JSON.parse
    // returns `any`) — validate for real before it reaches the DB, so a malformed
    // completion fails loudly here instead of corrupting stored data or crashing
    // deeper inside Prisma.
    const summaryInput = UpsertSummarySchema.parse({
      mood:       report.mood,
      moodEmoji:  report.moodEmoji,
      conclusion: report.conclusion,
      topics:     report.topics,
      risks:      report.risks,
      improves:   report.improves,
    });

    const analyticsInput = UpsertAnalyticsSchema.parse({
      conclusions:     report.conclusions,
      topicBars:       report.topicBars,
      risks:           report.risks,
      positives:       report.positives,
      recommendations: report.recommendations,
      altParagraphs:   report.altParagraphs.map((a) => ({
        tag:   a.tag,
        text:  a.text,
        color: ALT_TAG_COLORS[a.tag] ?? DEFAULT_ALT_COLOR,
      })),
      extras:          audit,
    });

    await discussionService.upsertSummary(projectId, summaryInput);
    return analyticsService.upsertAnalytics(projectId, analyticsInput);
  },
};
