import { Router } from 'express';
import { suggestController } from '../controllers/suggest.controller';
import healthRouter    from './health';
import personasRouter  from './personas';
import projectsRouter  from './projects';
import documentsRouter from './documents';
import { llmLimiter } from '../middlewares/rateLimit';

const router = Router();

router.use('/health',    healthRouter);
router.use('/personas',  personasRouter);
router.use('/projects',  projectsRouter);
router.use('/documents', documentsRouter);

// ── LLM Suggest ──────────────────────────────────────────────
// An LLM call that belongs to no project: nothing to scope it by, no row left
// behind, so the limiter is the only thing bounding it (SECURITY.md item 4).
router.post('/suggest/personas', llmLimiter, suggestController.suggestPersonas);

export default router;
