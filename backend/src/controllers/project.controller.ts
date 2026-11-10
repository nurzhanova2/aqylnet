import { Request, Response, NextFunction } from 'express';
import { projectService } from '../services/project.service';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  AddPersonaToProjectSchema,
} from '../validators/project.validator';
import { BadRequestError } from '../utils/errors';
import { ok } from '../types/api';
import { projectIdOf } from '../middlewares/projectOwnership';

function parseId(param: unknown): number {
  const id = parseInt(String(param), 10);
  if (isNaN(id) || id <= 0) throw new BadRequestError('id must be a positive integer');
  return id;
}

export const projectController = {
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projects = await projectService.getAll(req.sessionKey);
      res.json(ok(projects));
    } catch (e) {
      next(e);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = projectIdOf(req);
      const project = await projectService.getById(id);
      res.json(ok(project));
    } catch (e) {
      next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = CreateProjectSchema.parse(req.body);
      const project = await projectService.create(input, req.sessionKey);
      res.status(201).json(ok(project, 'Project created'));
    } catch (e) {
      next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = projectIdOf(req);
      const input = UpdateProjectSchema.parse(req.body);
      const project = await projectService.update(id, input);
      res.json(ok(project, 'Project updated'));
    } catch (e) {
      next(e);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = projectIdOf(req);
      await projectService.delete(id);
      res.json(ok(null, 'Project deleted'));
    } catch (e) {
      next(e);
    }
  },

  // ─── Persona sub-resource ──────────────────────────────────

  async getPersonas(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const personas = await projectService.getPersonas(projectId);
      res.json(ok(personas));
    } catch (e) {
      next(e);
    }
  },

  async addPersona(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const input = AddPersonaToProjectSchema.parse(req.body);
      const personas = await projectService.addPersona(projectId, input);
      res.status(201).json(ok(personas, 'Persona added to project'));
    } catch (e) {
      next(e);
    }
  },

  async removePersona(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectId = projectIdOf(req);
      const personaId = parseId(req.params.personaId);
      const personas = await projectService.removePersona(projectId, personaId);
      res.json(ok(personas, 'Persona removed from project'));
    } catch (e) {
      next(e);
    }
  },
};
