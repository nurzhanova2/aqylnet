import { Router } from 'express';
import { projectController }    from '../controllers/project.controller';
import { discussionController } from '../controllers/discussion.controller';
import { analyticsController }  from '../controllers/analytics.controller';
import { iterationController }  from '../controllers/iteration.controller';
import { reportController }     from '../controllers/report.controller';
import { personaScoreController } from '../controllers/personaScore.controller';
import { audienceAnalysisController } from '../controllers/audienceAnalysis.controller';
import { rewriteController } from '../controllers/rewrite.controller';
import { llmLimiter }            from '../middlewares/rateLimit';
import { projectIdParam }        from '../middlewares/projectOwnership';

const router = Router();

// ── Workspace ownership guard ────────────────────────────────
// The rule itself lives in middlewares/projectOwnership.ts, shared with the
// /documents routes, which take a projectId of their own and were outside this
// guard entirely. Any new route that declares :id inherits it automatically —
// do not add a separate router that bypasses it.
router.param('id', projectIdParam);

// ── Project CRUD ──────────────────────────────────────────────
router.get('/',     projectController.getAll);
// Creating a project is an LLM route too: project.service derives each
// persona's per-document position (LLM scenario 7.2) before the row is
// written. Easy to miss, because the cost is not in the route name.
router.post('/',    llmLimiter, projectController.create);
router.get('/:id',  projectController.getById);
router.patch('/:id',  projectController.update);
router.delete('/:id', projectController.delete);

// ── Persona sub-resource ─────────────────────────────────────
router.get('/:id/personas',                   projectController.getPersonas);
router.post('/:id/personas',                  projectController.addPersona);
router.delete('/:id/personas/:personaId',     projectController.removePersona);

// ── Discussion sub-resources (Loop 5) ────────────────────────
router.get('/:id/timeline',  discussionController.getTimeline);
router.post('/:id/timeline', discussionController.addTimelineMessage);
router.patch('/:id/timeline/:messageId', discussionController.updateModeratorMessage);


router.get('/:id/summary',   discussionController.getSummary);
router.put('/:id/summary',   discussionController.upsertSummary);

// ── Analytics sub-resource (Loop 6) ─────────────────────────
router.get('/:id/analytics', analyticsController.getAnalytics);
router.put('/:id/analytics', analyticsController.upsertAnalytics);

// ── Run iteration (LLM) ───────────────────────────────────────
// Up to one call per persona plus the moderator — the most expensive request
// in the API.
router.post('/:id/run-iteration', llmLimiter, iterationController.runIteration);

// ── Generate final report from discussion (LLM) ────────────────
// The discussion report and the document audit in parallel: one report call
// plus one call per document section, the checklist, the intended-messages
// alignment and, when switched on, the contradictions check.
router.post('/:id/generate-report', llmLimiter, reportController.generateReport);

// ── Persona scores (LLM, A1 stage 1) ──────────────────────────
// One call per persona over the whole document, up to 4 at once — independent
// of the discussion. POST replaces the project's scores whole.
router.post('/:id/persona-scores', llmLimiter, personaScoreController.run);
router.get('/:id/persona-scores',  personaScoreController.get);

// ── Audience analysis (LLM, A1 stage 2) ───────────────────────
// Up to five calls: the decision reference, the verdicts, one per group.
// 409 until the persona scores exist. GET computes the group levels, the gap
// and the terms by code on every read.
router.post('/:id/audience-analysis', llmLimiter, audienceAnalysisController.run);
router.get('/:id/audience-analysis',  audienceAnalysisController.get);

// ── Three versions of the text (LLM, A1 stage 3) ──────────────
// All three: the card, the brief, the full text (one call per section, up to
// 4 at once, plus «Главное»). One layer: card | brief | full. 409 until the
// audience analysis exists.
router.post('/:id/rewrites',        llmLimiter, rewriteController.run);
router.post('/:id/rewrites/:layer', llmLimiter, rewriteController.runLayer);
router.get('/:id/rewrites',         rewriteController.get);

export default router;
