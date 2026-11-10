import { z } from 'zod';
import { PERSONA_GROUPS } from '../config/personaGroups';
import { MAX_MISSING_PER_GROUP } from '../config/limits';
import { DECISION_ACTORS, DECISION_DIRECTIONS, DECISION_VERDICTS } from '../services/llm.service';

// Audience analysis (A1 stage 2).
//
// POST /projects/:id/audience-analysis takes no body: what is analysed is the
// project's persona scores. A body is accepted and ignored.
export const RunAudienceAnalysisSchema = z.object({}).passthrough();

// The row as it is written. The model's answers are normalised before this
// (llm.service), and every verdict of the server's own — verified, by, counts
// — is set by the service. Nothing reaches the table without Zod.

// One field of the reference (decision_reference@2). `value` is null unless its
// quote is verbatim in the text and names what the field says; `proposed` is
// what the model said, kept for the report.
const fieldValue = z.union([z.enum(DECISION_ACTORS), z.enum(DECISION_DIRECTIONS), z.number()]).nullable();
export const ReferenceFieldSchema = z.object({
  value:    fieldValue,
  proposed: fieldValue,
  quote:    z.string(),
  verified: z.boolean().nullable(),
  reason:   z.string(),
});

const NO_FIELD = { value: null, proposed: null, quote: '', verified: null, reason: 'нет в анализе до decision_reference@2' };

export const DecisionReferenceSchema = z.object({
  quote:    z.string(),
  section:  z.string(),
  // Server verdict: one sentence, verbatim in the text without running lines.
  // null = the model named no sentence.
  verified: z.boolean().nullable(),
  reason:   z.string(),
  // Absent in analyses stored by decision_reference@1: read as not named.
  actor:     ReferenceFieldSchema.default(NO_FIELD),
  direction: ReferenceFieldSchema.default(NO_FIELD),
  value:     ReferenceFieldSchema.default(NO_FIELD),
});

export const PersonaVerdictSchema = z.object({
  personaId: z.number().int().positive(),
  // null = no verdict: no reference, no answer, or the model skipped it.
  verdict:   z.enum(DECISION_VERDICTS).nullable(),
  reason:    z.string(),
  // Since decision_verdict@4 always code; model — analyses stored by @1–@3.
  by:        z.enum(['model', 'code']),
  // What the model extracted from the answer; null fields = «не указано»,
  // the whole null = not extracted (no call, or an analysis before @4).
  extracted: z.object({
    named:     z.boolean(),
    actor:     z.enum(DECISION_ACTORS).nullable(),
    direction: z.enum(DECISION_DIRECTIONS).nullable(),
    value:     z.number().nullable(),
  }).nullable().default(null),
});

export const MissingItemSchema = z.object({
  missing:    z.string().min(1),
  suggestion: z.string(),
  // Only ids the input carried; checked by code.
  sourceIds:  z.array(z.string()).min(1),
  sections:   z.array(z.string()),
  // Counted by code from sourceIds — the model never names it.
  personas:   z.number().int().min(1),
  // One question of a persona, verbatim from the stored scores; null when the
  // sources hold no question.
  question:   z.string().nullable(),
});

export const GroupMissingSchema = z.object({
  // ok — the call ran; insufficient — no personas or no material, no call;
  // failed — the call failed or answered nothing usable.
  status:     z.enum(['ok', 'insufficient', 'failed']),
  reason:     z.string(),
  items:      z.array(MissingItemSchema).max(MAX_MISSING_PER_GROUP),
  // Items the model returned, and how many of them code dropped for having
  // no existing sourceId.
  returned:   z.number().int().min(0),
  dropped:    z.number().int().min(0),
  // Why: no existing id; no words of a persona among the sources (only a
  // verdict or a low score); one persona where the group has two or more.
  droppedBy:  z.object({ noSource: z.number().int().min(0), noWords: z.number().int().min(0), onePersona: z.number().int().min(0) })
    .default({ noSource: 0, noWords: 0, onePersona: 0 }),
  // Ids cited that the input did not carry (in kept and dropped items).
  unknownIds: z.number().int().min(0),
});

export const AudienceAnalysisRowSchema = z.object({
  projectId: z.number().int().positive(),
  scoresAt:  z.date(),
  reference: DecisionReferenceSchema,
  verdicts:  z.array(PersonaVerdictSchema),
  missing:   z.record(z.enum(PERSONA_GROUPS), GroupMissingSchema),
  versions:  z.record(z.string(), z.string()),
});

export type ReferenceField = z.infer<typeof ReferenceFieldSchema>;
export type DecisionReference = z.infer<typeof DecisionReferenceSchema>;
export type PersonaVerdict = z.infer<typeof PersonaVerdictSchema>;
export type MissingItem = z.infer<typeof MissingItemSchema>;
export type GroupMissing = z.infer<typeof GroupMissingSchema>;
export type AudienceAnalysisRow = z.infer<typeof AudienceAnalysisRowSchema>;
