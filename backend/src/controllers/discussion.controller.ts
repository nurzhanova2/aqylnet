import { Request, Response, NextFunction } from 'express';
import { discussionService } from '../services/discussion.service';
import {
  CreateTimelineMessageSchema,
  UpdateModeratorMessageSchema,
  UpsertSummarySchema,
} from '../validators/discussion.validator';
import { BadRequestError } from '../utils/errors';
import { ok } from '../types/api';
import { projectIdOf } from '../middlewares/projectOwnership';

function parseId(param: unknown): number {
  const id = parseInt(String(param), 10);
  if (isNaN(id) || id <= 0) throw new BadRequestError('id must be a positive integer');
  return id;
}

export const discussionController = {

  // ── Timeline ───────────────────────────────────────────────

  async getTimeline(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const timeline  = await discussionService.getTimeline(projectId);
      res.json(ok(timeline));
    } catch (e) { next(e); }
  },

  async addTimelineMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const input     = CreateTimelineMessageSchema.parse(req.body);
      const message   = await discussionService.addTimelineMessage(projectId, input);
      res.status(201).json(ok(message, 'Timeline message added'));
    } catch (e) { next(e); }
  },

  async updateModeratorMessage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const messageId = parseId(req.params.messageId);
      const input = UpdateModeratorMessageSchema.parse(req.body);
      const message = await discussionService.updateModeratorMessage(projectId, messageId, input);
      res.json(ok(message, 'Moderator message updated'));
    } catch (e) { next(e); }
  },

  // ── Summary ────────────────────────────────────────────────

  async getSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const summary   = await discussionService.getSummary(projectId);
      // 200 with null data if no summary yet — frontend handles gracefully
      res.json(ok(summary));
    } catch (e) { next(e); }
  },

  async upsertSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const input     = UpsertSummarySchema.parse(req.body);
      const summary   = await discussionService.upsertSummary(projectId, input);
      res.json(ok(summary, 'Summary saved'));
    } catch (e) { next(e); }
  },
};
