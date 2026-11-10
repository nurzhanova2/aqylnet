import { z } from 'zod';
import { SCORE_MAX, SCORE_MIN } from '../config/scoringScale';

// Persona scores (A1 stage 1).
//
// POST /projects/:id/persona-scores takes no body: what is scored is the
// project's document by the project's personas. A body is accepted and
// ignored, so a client sending `{}` is not refused.
export const RunPersonaScoresSchema = z.object({}).passthrough();

// The rows as they are written. The model's answer is normalised before this
// (llm.service normalizePersonaScore) — this is the last gate, the same rule as
// the audit: nothing the model produced reaches the table without Zod.
const score = z.number().int().min(SCORE_MIN).max(SCORE_MAX).nullable();

export const PersonaSectionScoreRowSchema = z.object({
  projectId:     z.number().int().positive(),
  personaId:     z.number().int().positive(),
  sectionId:     z.number().int().positive(),
  clarity:       score,
  reasons:       score,
  myAction:      score,
  rateSignal:    score,
  trust:         score,
  nullReasons:   z.record(z.string(), z.string()),
  // persona_score@3: the level chosen, its phrase, and whether code moved the
  // score into the ±1 band of that level.
  levels:        z.record(z.string(), z.object({
    level:    z.union([z.literal(1), z.literal(4), z.literal(7), z.literal(10)]).nullable(),
    why:      z.string(),
    adjusted: z.boolean(),
  })),
  terms:         z.number().int().min(SCORE_MIN).max(SCORE_MAX),
  termsFound:    z.array(z.string()),
  termsUnclear:  z.array(z.string()),
  skipped:       z.boolean(),
  read:          z.string(),
  unclear:       z.array(z.string()).max(3),
  quote:         z.string(),
  quoteHelped:   z.boolean().nullable(),
  // Server verdict: computed against the document, never taken from a request.
  quoteVerified: z.boolean().nullable(),
});

export const PersonaReadingRowSchema = z.object({
  projectId:         z.number().int().positive(),
  personaId:         z.number().int().positive(),
  status:            z.enum(['scored', 'failed']),
  failReason:        z.string(),
  mainTakeaway:      z.string(),
  decision:          z.string(),
  myAction:          z.string(),
  extraUnclearWords: z.array(z.string()),
  // Criterion 4, once per document (persona_score@3).
  rateSignal:        z.number().int().min(SCORE_MIN).max(SCORE_MAX).nullable(),
  levels:            z.record(z.string(), z.object({
    level:    z.union([z.literal(1), z.literal(4), z.literal(7), z.literal(10)]).nullable(),
    why:      z.string(),
    adjusted: z.boolean(),
    reason:   z.string(),
  })),
});

export type PersonaSectionScoreRow = z.infer<typeof PersonaSectionScoreRowSchema>;
export type PersonaReadingRow = z.infer<typeof PersonaReadingRowSchema>;
