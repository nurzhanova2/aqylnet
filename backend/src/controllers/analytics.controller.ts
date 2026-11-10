import { Request, Response, NextFunction } from 'express';
import { analyticsService }     from '../services/analytics.service';
import { UpsertAnalyticsSchema } from '../validators/analytics.validator';
import { ok }                   from '../types/api';
import { projectIdOf } from '../middlewares/projectOwnership';

export const analyticsController = {
  async getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const report    = await analyticsService.getAnalytics(projectId);
      res.json(ok(report));
    } catch (e) { next(e); }
  },

  async upsertAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const input     = UpsertAnalyticsSchema.parse(req.body);
      const report    = await analyticsService.upsertAnalytics(projectId, input);
      res.json(ok(report, 'Analytics report saved'));
    } catch (e) { next(e); }
  },
};
