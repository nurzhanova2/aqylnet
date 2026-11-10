import { prisma } from '../config/prisma';
import { Persona, TimelineMessage, DiscussionSummary, Prisma } from '@prisma/client';

// ─── Composite types ─────────────────────────────────────────

export type TimelineWithPersona = TimelineMessage & { persona: Persona | null };

// Accepts either the global client or an interactive-transaction client, so
// callers that need transactional atomicity (see iteration.service.ts's
// BUG-4 corrective fix) can pin these queries to their own transaction's
// connection instead of letting them run on whatever connection the pool
// hands out next.
type Db = typeof prisma | Prisma.TransactionClient;

// ─── Includes ────────────────────────────────────────────────

const INCLUDE_TIMELINE_PERSONA = { persona: true } as const;

// ─── Repository ──────────────────────────────────────────────

export const discussionRepository = {
  // ── Timeline ───────────────────────────────────────────────

  findTimeline(projectId: number, db: Db = prisma): Promise<TimelineWithPersona[]> {
    return db.timelineMessage.findMany({
      where: { projectId },
      include: INCLUDE_TIMELINE_PERSONA,
      orderBy: { n: 'asc' },
    });
  },

  /** Returns the next available sequence number n for a project. */
  async nextN(projectId: number, db: Db = prisma): Promise<number> {
    const last = await db.timelineMessage.findFirst({
      where:   { projectId },
      orderBy: { n: 'desc' },
      select:  { n: true },
    });
    return (last?.n ?? 0) + 1;
  },

  createTimelineMessage(data: {
    projectId:   number;
    personaId?:  number;
    speakerType?: string;
    n:           number;
    text:        string;
    iteration:   number;
    time:        string;
  }, db: Db = prisma): Promise<TimelineWithPersona> {
    return db.timelineMessage.create({
      data,
      include: INCLUDE_TIMELINE_PERSONA,
    });
  },

  findTimelineMessage(projectId: number, messageId: number): Promise<TimelineWithPersona | null> {
    return prisma.timelineMessage.findFirst({
      where: { id: messageId, projectId },
      include: INCLUDE_TIMELINE_PERSONA,
    });
  },

  updateTimelineMessageText(messageId: number, text: string): Promise<TimelineWithPersona> {
    return prisma.timelineMessage.update({
      where: { id: messageId },
      data: { text },
      include: INCLUDE_TIMELINE_PERSONA,
    });
  },

  // ── Summary ────────────────────────────────────────────────

  findSummary(projectId: number): Promise<DiscussionSummary | null> {
    return prisma.discussionSummary.findUnique({ where: { projectId } });
  },

  upsertSummary(
    projectId: number,
    data: Omit<DiscussionSummary, 'id' | 'projectId'>,
  ): Promise<DiscussionSummary> {
    return prisma.discussionSummary.upsert({
      where:  { projectId },
      create: { projectId, ...data },
      update: data,
    });
  },
};
