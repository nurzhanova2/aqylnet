import { prisma } from '../config/prisma';
import { AudienceAnalysisRow } from '../validators/audienceAnalysis.validator';

// Audience analysis (A1 stage 2). A run replaces the project's analysis whole,
// in one transaction.

export const audienceAnalysisRepository = {
  async replaceForProject(row: AudienceAnalysisRow): Promise<void> {
    await prisma.$transaction([
      prisma.audienceAnalysis.deleteMany({ where: { projectId: row.projectId } }),
      prisma.audienceAnalysis.create({ data: row }),
    ]);
  },

  find(projectId: number) {
    return prisma.audienceAnalysis.findUnique({ where: { projectId } });
  },
};
