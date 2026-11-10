import { Request, Response, NextFunction } from 'express';
import { ok } from '../types/api';
import { iterationService } from '../services/iteration.service';
import { projectIdOf } from '../middlewares/projectOwnership';

export const iterationController = {
  async runIteration(req: Request, res: Response, next: NextFunction) {
    try {
      const projectId = projectIdOf(req);
      const result = await iterationService.runIteration(projectId);
      res.json(ok(result));
    } catch (err) {
      next(err);
    }
  },
};
