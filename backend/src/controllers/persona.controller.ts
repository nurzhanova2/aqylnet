import { Request, Response, NextFunction } from 'express';
import { personaService } from '../services/persona.service';
import { CreatePersonaSchema, UpdatePersonaSchema } from '../validators/persona.validator';
import { BadRequestError } from '../utils/errors';
import { ok } from '../types/api';

function parseId(param: unknown): number {
  const id = parseInt(String(param), 10);
  if (isNaN(id) || id <= 0) throw new BadRequestError('id must be a positive integer');
  return id;
}

export const personaController = {
  async getAll(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const personas = await personaService.getAll();
      res.json(ok(personas));
    } catch (e) {
      next(e);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseId(req.params.id);
      const persona = await personaService.getById(id);
      res.json(ok(persona));
    } catch (e) {
      next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = CreatePersonaSchema.parse(req.body);
      const persona = await personaService.create(input);
      res.status(201).json(ok(persona, 'Persona created'));
    } catch (e) {
      next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseId(req.params.id);
      const input = UpdatePersonaSchema.parse(req.body);
      const persona = await personaService.update(id, input);
      res.json(ok(persona, 'Persona updated'));
    } catch (e) {
      next(e);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseId(req.params.id);
      await personaService.delete(id);
      res.json(ok(null, 'Persona deleted'));
    } catch (e) {
      next(e);
    }
  },
};
