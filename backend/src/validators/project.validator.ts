import { z } from 'zod';
import {
  MAX_DOCUMENT_TEXT_CHARS,
  MAX_INTENDED_MESSAGES,
  MAX_ITERATIONS,
  MAX_PERSONAS_PER_PROJECT,
} from '../config/limits';
import { DISCUSSION_MODES } from '../services/llm.service';
import { PERSONA_GROUPS } from '../config/personaGroups';

const GOALS = ['risk_search', 'consensus'] as const;

// A1 stage 2: what the document is and whom it was written for. Enums only,
// no free strings. The default audience per type is a Setup UI convenience;
// the server stores what the client sent. All three optional; null clears.
export const DOC_TYPES = ['press_release', 'mpr', 'fsr', 'analytical_note', 'other'] as const;

/** A calendar date, YYYY-MM-DD, that exists (no 2026-02-30). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'дата в формате ГГГГ-ММ-ДД')
  .refine((s) => { const d = new Date(`${s}T00:00:00Z`); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; }, 'такой даты нет');

// At least one group when the field is set; null (or omitting it) = not set.
const audience = z.array(z.enum(PERSONA_GROUPS)).min(1).max(PERSONA_GROUPS.length);

const documentMeta = {
  docType: z.enum(DOC_TYPES).nullable().optional(),
  publishedAt: isoDate.nullable().optional(),
  intendedAudience: audience.nullable().optional(),
};

export const CreateProjectSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string().default(''),
  mode: z.enum(DISCUSSION_MODES).default('Round Table'),
  iterations: z.number().int().min(1).max(MAX_ITERATIONS).default(5),
  currentIteration: z.number().int().min(0).default(0),
  moderator: z.boolean().default(true),
  goal: z.enum(GOALS).default('risk_search'),
  // Key messages the author wants the document to land. Scored in the report
  // against what the personas actually understood (intended vs perceived).
  // Three, not five: the Setup UI has always capped at three and the report
  // lays them out in three columns, so a fourth and fifth were accepted by the
  // API and then never shown anywhere (SECURITY.md item 31).
  intendedMessages: z.array(z.string().trim().min(1)).max(MAX_INTENDED_MESSAGES).default([]),
  // llmModel is deliberately absent — see UpdateProjectSchema below.
  documentText: z.string().max(MAX_DOCUMENT_TEXT_CHARS).optional(),
  documentFile: z.string().optional(),
  documentFileName: z.string().optional(),
  // The 8-persona group limit used to live only in the Setup UI. Unbounded
  // here, one request could put the whole library in a project and make every
  // round 33 LLM calls instead of 9.
  personaIds: z
    .array(z.number().int().positive())
    .max(MAX_PERSONAS_PER_PROJECT)
    .default([]),
  // Per-discussion stance override, keyed by personaId (as string — JSON object keys).
  // Omit a persona's id to keep using that persona's own default stance.
  personaStances: z.record(z.string(), z.string()).default({}),
  ...documentMeta,
});

// Lifecycle fields are deliberately absent. `status` and `currentIteration`
// used to be accepted here with no cross-checks, so a PATCH could reset the
// counter to 0 and lift the round limit entirely — unlimited LLM spend on one
// project, by design of the validator. Both are owned by the round itself:
// iteration.service advances currentIteration only after a whole round is
// written, inside the transaction that guarantees it. Nothing outside that
// transaction has any business setting them, and the frontend never did — it
// PATCHes `{ moderator }` and nothing else.
//
// Zod strips unknown keys, so a client that still sends status or
// currentIteration is ignored rather than rejected: the fields simply do not
// reach the repository.
export const UpdateProjectSchema = z.object({
  title: z.string().min(1).optional(),
  subtitle: z.string().optional(),
  mode: z.enum(DISCUSSION_MODES).optional(),
  iterations: z.number().int().min(1).max(MAX_ITERATIONS).optional(),
  moderator: z.boolean().optional(),
  goal: z.enum(GOALS).optional(),
  intendedMessages: z.array(z.string().trim().min(1)).max(MAX_INTENDED_MESSAGES).optional(),
  // llmModel is gone from both schemas (SECURITY.md item 28). It was a free
  // string the client could set to anything, while every actual call goes to
  // env.llmModel — so the report could be signed with the name of a model that
  // was never asked. The column stays, because "which model produced this
  // report" is worth knowing, but it is now written by the server at creation
  // and never again: see project.service.ts.
  documentText: z.string().max(MAX_DOCUMENT_TEXT_CHARS).optional(),
  documentFile: z.string().optional(),
  documentFileName: z.string().optional(),
  ...documentMeta,
});

export const AddPersonaToProjectSchema = z.object({
  personaId: z.number().int().positive(),
  stance: z.string().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
export type AddPersonaToProjectInput = z.infer<typeof AddPersonaToProjectSchema>;
