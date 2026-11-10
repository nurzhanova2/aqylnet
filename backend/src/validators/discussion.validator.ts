import { z } from 'zod';
import { MAX_MESSAGE_CHARS } from '../config/limits';

const TIME_REGEX = /^\d{2}:\d{2}:\d{2}$/;
const currentTime = () => new Date().toTimeString().slice(0, 8);

// ─── Timeline ────────────────────────────────────────────────

export const CreateTimelineMessageSchema = z.object({
  personaId:   z.number().int().positive().optional(),
  speakerType: z.enum(['persona', 'moderator']).default('persona'),
  // Goes straight into the transcript, which is replayed verbatim into every
  // later persona, moderator and report prompt.
  text:        z.string().min(1).max(MAX_MESSAGE_CHARS),
  iteration:   z.number().int().min(1).default(1),
  time:        z.string().regex(TIME_REGEX, 'time must be HH:MM:SS').default(currentTime),
});

export const UpdateModeratorMessageSchema = z.object({
  text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

// ─── Summary ─────────────────────────────────────────────────

export const UpsertSummarySchema = z.object({
  mood: z.string().min(1),
  moodEmoji: z.string().default('😐'),
  conclusion: z.string().default(''),
  topics: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  improves: z.array(z.string()).default([]),
});

// ─── Types ───────────────────────────────────────────────────

export type CreateTimelineMessageInput = z.infer<typeof CreateTimelineMessageSchema>;
export type UpdateModeratorMessageInput = z.infer<typeof UpdateModeratorMessageSchema>;
export type UpsertSummaryInput = z.infer<typeof UpsertSummarySchema>;
