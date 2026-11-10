import { Request, Response, NextFunction } from 'express';
import { audienceAnalysisService } from '../services/audienceAnalysis.service';
import { RunAudienceAnalysisSchema } from '../validators/audienceAnalysis.validator';
import { ok } from '../types/api';
import { projectIdOf } from '../middlewares/projectOwnership';

export const audienceAnalysisController = {
  async run(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      RunAudienceAnalysisSchema.parse(req.body ?? {});
      res.json(ok(await audienceAnalysisService.run(projectId), 'Audience analysis computed'));
    } catch (e) { next(e); }
  },

  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      res.json(ok(await audienceAnalysisService.get(projectId)));
    } catch (e) { next(e); }
  },
};
