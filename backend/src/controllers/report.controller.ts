import { Request, Response, NextFunction } from 'express';
import { reportService } from '../services/report.service';
import { ok } from '../types/api';
import { projectIdOf } from '../middlewares/projectOwnership';

export const reportController = {
  async generateReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const report = await reportService.generateReport(projectId);
      res.json(ok(report, 'Report generated'));
    } catch (e) { next(e); }
  },
};
