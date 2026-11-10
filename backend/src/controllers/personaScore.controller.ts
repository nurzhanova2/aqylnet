import { Request, Response, NextFunction } from 'express';
import { personaScoreService } from '../services/personaScore.service';
import { RunPersonaScoresSchema } from '../validators/personaScore.validator';
import { ok } from '../types/api';
import { projectIdOf } from '../middlewares/projectOwnership';

export const personaScoreController = {
  async run(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      RunPersonaScoresSchema.parse(req.body ?? {});
      const result = await personaScoreService.run(projectId);
      res.json(ok(result, 'Persona scores computed'));
    } catch (e) { next(e); }
  },

  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      res.json(ok(await personaScoreService.get(projectId)));
    } catch (e) { next(e); }
  },
};
