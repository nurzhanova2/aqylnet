import { Request, Response, NextFunction } from 'express';
import { rewriteService } from '../services/rewrite.service';
import { RewriteLayerParamSchema, RunRewritesSchema } from '../validators/rewrite.validator';
import { BadRequestError } from '../utils/errors';
import { ok } from '../types/api';
import { projectIdOf } from '../middlewares/projectOwnership';

export const rewriteController = {
  async run(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      RunRewritesSchema.parse(req.body ?? {});
      res.json(ok(await rewriteService.run(projectId), 'Rewrites generated'));
    } catch (e) { next(e); }
  },

  async runLayer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const layer = RewriteLayerParamSchema.safeParse(req.params.layer);
      if (!layer.success) throw new BadRequestError('layer: card | brief | full');
      RunRewritesSchema.parse(req.body ?? {});
      res.json(ok(await rewriteService.runLayer(projectId, layer.data), 'Rewrite generated'));
    } catch (e) { next(e); }
  },

  async get(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      res.json(ok(await rewriteService.get(projectId)));
    } catch (e) { next(e); }
  },
};
