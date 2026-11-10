import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ok } from '../types/api';
import { prisma } from '../config/prisma';
import { suggestPersonas } from '../services/llm.service';
import { assertDailyBudget, withUsageContext } from '../services/llmUsage.service';

// ─── POST /api/suggest/personas ──────────────────────────────
// Body: { documentText: string, count?: number }
// Returns: { personaIds: number[] }
//
// There used to be a second handler here, POST /projects/:id/moderator-message.
// No client called it, and it was the one LLM route outside the daily token
// ceiling. The moderator question is generated inside the round
// (iteration.service), which is where it belongs.

const SuggestSchema = z.object({
  documentText: z.string().min(50, 'Текст документа слишком короткий'),
  count:        z.number().int().min(1).max(32).default(8),
});

export const suggestController = {
  async suggestPersonas(req: Request, res: Response, next: NextFunction) {
    try {
      const { documentText, count } = SuggestSchema.parse(req.body);

      // Frequency limiting alone never closed this route: it belongs to no
      // project and leaves no row, so a patient caller could hold 40 requests
      // per 5 minutes indefinitely. The counted daily quota is what bounds it
      // (SECURITY.md item 4), and it is checked before the persona query so a
      // refusal costs nothing.
      await assertDailyBudget('suggest_personas');

      const personas = await prisma.persona.findMany({
        select: {
          id:        true,
          name:      true,
          role:      true,
          stance:    true,
          interests: true,
          industry:  true,
        },
      });

      // No project to attribute the spend to — the call happens while the user
      // is still choosing a cast. Recorded with projectId null.
      const ids = await withUsageContext({}, () => suggestPersonas(documentText, personas, count));

      res.json(ok({ personaIds: ids }));
    } catch (err) {
      next(err);
    }
  },
};
