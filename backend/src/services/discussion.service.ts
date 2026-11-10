import { discussionRepository, TimelineWithPersona } from '../repositories/discussion.repository';
import { personaRepository } from '../repositories/persona.repository';
import { projectRepository } from '../repositories/project.repository';
import { NotFoundError, BadRequestError } from '../utils/errors';
import {
  CreateTimelineMessageInput,
  UpdateModeratorMessageInput,
  UpsertSummaryInput,
} from '../validators/discussion.validator';
import { DiscussionSummary } from '@prisma/client';

// ─── DTOs — shape matches frontend mock format ────────────────

export interface TimelineMessageDTO {
  id:          number;
  n:           number;
  speakerType: string;  // "persona" | "moderator"
  name:        string;  // persona.name OR "Модератор"
  dot:         string;  // persona.dot OR moderator accent colour
  time:        string;
  personaId:   number | null; // real Persona.id — null for moderator messages.
                               // Use this (not personaIdx) to match a message
                               // to a specific persona: personaIdx is really
                               // avatarIdx (for avatar image lookup only) and
                               // is not guaranteed unique across personas.
  personaIdx:  number;  // persona.avatarIdx OR -1 for moderator
  text:        string;
  iteration:   number;
}

export interface DiscussionSummaryDTO {
  mood:       string;
  moodEmoji:  string;
  conclusion: string;
  topics:     string[];
  risks:      string[];
  improves:   string[];
}

// ─── Presenters ──────────────────────────────────────────────

// Replies whose persona was deleted before the stage E2 guard existed.
//
// TimelineMessage.persona is an optional relation with no explicit onDelete, so
// Prisma defaulted to SetNull: deleting a library persona blanked the author of
// every reply it had ever made. The live database carries 11 such rows across 4
// discussions, three of which already have finished reports built on that text.
//
// Deleting them was considered and rejected: the text is real and substantive,
// and removing it would turn a cosmetic defect — a blank name — into actual
// data loss in reports that are already issued. Re-attribution is impossible,
// because which persona spoke is exactly what was lost. So the rows stay and
// the gap is labelled instead of rendering as an empty string.
const DELETED_SPEAKER_NAME = 'Удалённый участник';

export function toTimelineDTO(m: TimelineWithPersona): TimelineMessageDTO {
  const isMod = m.speakerType === 'moderator';
  return {
    id:          m.id,
    n:           m.n,
    speakerType: m.speakerType,
    name:        isMod ? 'Модератор' : (m.persona?.name ?? DELETED_SPEAKER_NAME),
    // Модератор — «особое» состояние палитры: он не участник и не должен
    // попадать в цветовой ряд персон. Удалённый автор — нейтральный серый.
    dot:         isMod ? '#a48bff'   : (m.persona?.dot  ?? '#8d928f'),
    time:        m.time,
    personaId:   isMod ? null : m.personaId,
    personaIdx:  isMod ? -1          : (m.persona?.avatarIdx ?? 0),
    text:        m.text,
    iteration:   m.iteration,
  };
}

function toSummaryDTO(s: DiscussionSummary): DiscussionSummaryDTO {
  return {
    mood:       s.mood,
    moodEmoji:  s.moodEmoji,
    conclusion: s.conclusion,
    topics:     s.topics,
    risks:      s.risks,
    improves:   s.improves,
  };
}

// ─── Guards ──────────────────────────────────────────────────

async function assertProject(projectId: number): Promise<void> {
  const project = await projectRepository.findById(projectId);
  if (!project) throw new NotFoundError(`Project with id ${projectId} not found`);
}

async function assertPersona(personaId: number): Promise<void> {
  const persona = await personaRepository.findById(personaId);
  if (!persona) throw new NotFoundError(`Persona with id ${personaId} not found`);
}

// ─── Service ─────────────────────────────────────────────────

export const discussionService = {

  // ── Timeline ───────────────────────────────────────────────

  async getTimeline(projectId: number): Promise<TimelineMessageDTO[]> {
    await assertProject(projectId);
    const rows = await discussionRepository.findTimeline(projectId);
    return rows.map(toTimelineDTO);
  },

  async addTimelineMessage(
    projectId: number,
    input: CreateTimelineMessageInput,
  ): Promise<TimelineMessageDTO> {
    await assertProject(projectId);
    if (input.speakerType !== 'moderator' && input.personaId) {
      await assertPersona(input.personaId);
    }

    const n = await discussionRepository.nextN(projectId);

    const row = await discussionRepository.createTimelineMessage({
      projectId,
      personaId:   input.speakerType === 'moderator' ? undefined : input.personaId,
      speakerType: input.speakerType,
      n,
      text:        input.text,
      iteration:   input.iteration,
      time:        input.time,
    });

    return toTimelineDTO(row);
  },

  async updateModeratorMessage(
    projectId: number,
    messageId: number,
    input: UpdateModeratorMessageInput,
  ): Promise<TimelineMessageDTO> {
    await assertProject(projectId);
    const existing = await discussionRepository.findTimelineMessage(projectId, messageId);
    if (!existing) throw new NotFoundError('Timeline message ' + messageId + ' not found');
    if (existing.speakerType !== 'moderator') {
      throw new BadRequestError('Only moderator messages can be edited');
    }
    const row = await discussionRepository.updateTimelineMessageText(messageId, input.text);
    return toTimelineDTO(row);
  },

  // ── Summary ────────────────────────────────────────────────

  async getSummary(projectId: number): Promise<DiscussionSummaryDTO | null> {
    await assertProject(projectId);
    const row = await discussionRepository.findSummary(projectId);
    return row ? toSummaryDTO(row) : null;
  },

  async upsertSummary(
    projectId: number,
    input: UpsertSummaryInput,
  ): Promise<DiscussionSummaryDTO> {
    await assertProject(projectId);
    const row = await discussionRepository.upsertSummary(projectId, input);
    return toSummaryDTO(row);
  },
};
