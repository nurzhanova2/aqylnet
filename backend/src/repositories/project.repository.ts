import { prisma } from '../config/prisma';
import { Project } from '@prisma/client';
import { PersonaWithContexts } from './persona.repository';
import { replaceSections, sectionRows } from '../services/documentSection.service';

// ─── Types ───────────────────────────────────────────────────

// Just enough of a persona to draw its chibi badge in the projects list —
// deliberately not the full persona graph, which INCLUDE_PERSONAS pulls.
export interface ProjectPersonaFace {
  id:        number;
  name:      string;
  dot:       string;
  avatarIdx: number;
  gender:    string;
  look:      unknown;
}

export type ProjectWithCount = Project & {
  _count:   { personas: number };
  personas: { persona: ProjectPersonaFace }[];
};

export interface ProjectPersonaRow {
  persona:           PersonaWithContexts;
  stanceOverride:    string | null;
  reasoningOverride: string | null;
  priorityOverride:  string | null;
  fearsOverride:     string | null;
  thinkingOverride:  string | null;
}

export type ProjectWithPersonas = Project & {
  personas: ProjectPersonaRow[];
};

export interface PersonaCreateOverrides {
  stance?:    string | null;
  reasoning?: string | null;
  priority?:  string | null;
  fears?:     string | null;
  thinking?:  string | null;
}

// ─── Includes ────────────────────────────────────────────────

// The list shows up to four faces plus a "+N" overflow badge, so five rows is
// all the preview ever needs — the count comes from _count, not from this.
const FACES_IN_LIST = 5;

const INCLUDE_COUNT = {
  _count: { select: { personas: true } },
  personas: {
    take: FACES_IN_LIST,
    orderBy: { persona: { avatarIdx: 'asc' as const } },
    select: {
      persona: {
        select: { id: true, name: true, dot: true, avatarIdx: true, gender: true, look: true },
      },
    },
  },
} as const;

const INCLUDE_PERSONAS = {
  personas: {
    include: {
      persona: { include: { contexts: true } },
    },
    orderBy: { persona: { avatarIdx: 'asc' as const } },
  },
} as const;

// ─── Repository ──────────────────────────────────────────────

export const projectRepository = {
  // Scoped to one browser's workspace key. Rows with ownerKey = null predate
  // the column (or were created by a client that sends no key) and stay
  // visible to everyone, so an existing database keeps working after the
  // schema push instead of appearing empty.
  findAll(ownerKey?: string): Promise<ProjectWithCount[]> {
    return prisma.project.findMany({
      where: ownerKey ? { OR: [{ ownerKey }, { ownerKey: null }] } : { ownerKey: null },
      include: INCLUDE_COUNT,
      orderBy: { createdAt: 'desc' },
    });
  },

  // Deliberately selects the single column the ownership guard needs: it runs
  // before every /projects/:id route, including the sub-resources, and must
  // not drag in the persona graph that INCLUDE_PERSONAS pulls.
  findOwnerKey(id: number): Promise<{ ownerKey: string | null } | null> {
    return prisma.project.findUnique({
      where:  { id },
      select: { ownerKey: true },
    });
  },

  findById(id: number): Promise<ProjectWithPersonas | null> {
    return prisma.project.findUnique({
      where: { id },
      include: INCLUDE_PERSONAS,
    });
  },

  create(
    data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
    personaIds: number[],
    personaStances: Record<string, string> = {},
    personaOverrides: Record<string, PersonaCreateOverrides> = {},
  ): Promise<ProjectWithPersonas> {
    return prisma.project.create({
      data: {
        ...data,
        // Created with the row, so a project never exists without the sections
        // of its document (A1 stage 0).
        sections: { create: sectionRows(data.documentText) },
        personas: {
          create: personaIds.map((personaId) => {
            const ov = personaOverrides[String(personaId)] ?? {};
            return {
              personaId,
              // Explicit user pick (SetupPage за/против dropdown) wins over the
              // LLM-derived per-document stance, which wins over persona default.
              stanceOverride:    personaStances[String(personaId)] || ov.stance || null,
              reasoningOverride: ov.reasoning || null,
              priorityOverride:  ov.priority || null,
              fearsOverride:     ov.fears || null,
              thinkingOverride:  ov.thinking || null,
            };
          }),
        },
      },
      include: INCLUDE_PERSONAS,
    });
  },

  update(
    id: number,
    data: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<ProjectWithPersonas> {
    // A new document text rewrites its sections in the same transaction; any
    // other change leaves them alone.
    if (data.documentText === undefined) {
      return prisma.project.update({ where: { id }, data, include: INCLUDE_PERSONAS });
    }
    return prisma.$transaction(async (tx) => {
      const row = await tx.project.update({ where: { id }, data, include: INCLUDE_PERSONAS });
      await replaceSections(tx, id, row.documentText);
      return row;
    });
  },

  delete(id: number): Promise<Project> {
    return prisma.project.delete({ where: { id } });
  },

  // ─── Persona sub-resource ──────────────────────────────────

  findProjectPersona(projectId: number, personaId: number) {
    return prisma.projectPersona.findUnique({
      where: { projectId_personaId: { projectId, personaId } },
    });
  },

  addPersona(projectId: number, personaId: number, stanceOverride: string | null = null) {
    return prisma.projectPersona.create({
      data: { projectId, personaId, stanceOverride },
    });
  },

  // Atomically checks "is this the last persona?" and deletes in one
  // transaction, row-locking the project's ProjectPersona rows for the
  // duration so two concurrent removals of the last two personas can't both
  // read "2 remaining" before either commits (BUG-3: TOCTOU race — a plain
  // count-then-delete would let both requests pass the guard and leave the
  // project with zero personas). `SELECT ... FOR UPDATE` can't be combined
  // with an aggregate like COUNT(*), so the row set itself is selected and
  // counted in JS.
  async removePersonaGuarded(
    projectId: number,
    personaId: number,
  ): Promise<'removed' | 'not_found' | 'last_persona'> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ personaId: number }[]>`
        SELECT "personaId" FROM "ProjectPersona" WHERE "projectId" = ${projectId} FOR UPDATE
      `;
      if (!rows.some((r) => r.personaId === personaId)) return 'not_found';
      if (rows.length <= 1) return 'last_persona';
      await tx.projectPersona.delete({ where: { projectId_personaId: { projectId, personaId } } });
      return 'removed';
    });
  },

  findPersonas(projectId: number): Promise<ProjectPersonaRow[]> {
    return prisma.projectPersona.findMany({
      where: { projectId },
      include: { persona: { include: { contexts: true } } },
      orderBy: { persona: { avatarIdx: 'asc' } },
    });
  },
};
