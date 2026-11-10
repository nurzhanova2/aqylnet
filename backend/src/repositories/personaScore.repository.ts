import { prisma } from '../config/prisma';
import { PersonaReadingRow, PersonaSectionScoreRow } from '../validators/personaScore.validator';

// Persona scores (A1 stage 1). A run replaces the project's scores whole, in
// one transaction: a reader never sees half of one run and half of another.

export const personaScoreRepository = {
  async replaceForProject(projectId: number, scores: PersonaSectionScoreRow[], readings: PersonaReadingRow[]): Promise<void> {
    await prisma.$transaction([
      prisma.personaSectionScore.deleteMany({ where: { projectId } }),
      prisma.personaReading.deleteMany({ where: { projectId } }),
      prisma.personaReading.createMany({ data: readings }),
      prisma.personaSectionScore.createMany({ data: scores }),
    ]);
  },

  findScores(projectId: number) {
    return prisma.personaSectionScore.findMany({ where: { projectId }, orderBy: [{ personaId: 'asc' }, { sectionId: 'asc' }] });
  },

  findReadings(projectId: number) {
    return prisma.personaReading.findMany({
      where: { projectId },
      include: { persona: { select: { id: true, name: true, role: true, group: true, avatarIdx: true, dot: true, look: true, gender: true } } },
      orderBy: { personaId: 'asc' },
    });
  },
};
