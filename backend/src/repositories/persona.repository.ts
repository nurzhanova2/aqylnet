import { prisma } from '../config/prisma';
import { Persona, PersonaContext, Prisma } from '@prisma/client';

export type PersonaWithContexts = Persona & { contexts: PersonaContext[] };

// Scalar persona fields plus the nullable Json `look`. Prisma rejects a plain
// JS null for nullable Json columns (it must be Prisma.DbNull), so `look` is
// typed and converted explicitly: undefined — поле не трогаем, null — очистить.
type PersonaData = Omit<Persona, 'id' | 'createdAt' | 'updatedAt' | 'look'> & {
  look?: Prisma.InputJsonValue | null;
};

function toLookWrite(look: Prisma.InputJsonValue | null | undefined) {
  if (look === undefined) return undefined; // не передан — не изменять
  return look === null ? Prisma.DbNull : look; // явный null — очистить
}

const INCLUDE_CONTEXTS = { contexts: true } as const;

export const personaRepository = {
  findAll(): Promise<PersonaWithContexts[]> {
    return prisma.persona.findMany({
      include: INCLUDE_CONTEXTS,
      orderBy: { avatarIdx: 'asc' },
    });
  },

  findById(id: number): Promise<PersonaWithContexts | null> {
    return prisma.persona.findUnique({
      where: { id },
      include: INCLUDE_CONTEXTS,
    });
  },

  findByName(name: string): Promise<Persona | null> {
    return prisma.persona.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
  },

  create(
    data: PersonaData,
    contexts: { src: string; quote: string }[],
  ): Promise<PersonaWithContexts> {
    const { look, ...rest } = data;
    return prisma.persona.create({
      data: {
        ...rest,
        look: toLookWrite(look),
        contexts: { create: contexts },
      },
      include: INCLUDE_CONTEXTS,
    });
  },

  update(
    id: number,
    data: Partial<PersonaData>,
    contexts?: { src: string; quote: string }[],
  ): Promise<PersonaWithContexts> {
    const { look, ...rest } = data;
    return prisma.$transaction(async (tx) => {
      if (contexts !== undefined) {
        await tx.personaContext.deleteMany({ where: { personaId: id } });
      }
      return tx.persona.update({
        where: { id },
        data: {
          ...rest,
          look: toLookWrite(look),
          ...(contexts !== undefined && { contexts: { create: contexts } }),
        },
        include: INCLUDE_CONTEXTS,
      });
    });
  },

  // This guard once looked *only* at Dialog — a table nothing ever wrote —
  // while the real transcript lives in TimelineMessage. TimelineMessage.persona is an optional relation with no
  // explicit onDelete, so Prisma defaults to SetNull: deleting a persona left
  // every reply it had ever made in every project with personaId = null and a
  // blank speaker name. The rows survive, the attribution does not, and the
  // damage lands in other people's discussions.
  hasTimelineReferences(id: number): Promise<boolean> {
    return prisma.timelineMessage
      .findFirst({ where: { personaId: id } })
      .then((row) => row !== null);
  },

  // ProjectPersona.persona cascades on delete, so removing a library persona
  // silently drops it from every project's cast — bypassing
  // removePersonaGuarded, which exists to stop a project being left with no
  // personas at all.
  hasProjectReferences(id: number): Promise<boolean> {
    return prisma.projectPersona
      .findFirst({ where: { personaId: id } })
      .then((row) => row !== null);
  },

  delete(id: number): Promise<Persona> {
    return prisma.persona.delete({ where: { id } });
  },
};
