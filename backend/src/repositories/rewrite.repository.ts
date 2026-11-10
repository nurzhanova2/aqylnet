import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { RewriteLayer, RewriteLayers } from '../validators/rewrite.validator';

// Three versions of the text (A1 stage 3). A run of all three replaces the row
// whole in one transaction; a run of one layer writes that column only.

const json = (v: unknown) => (v === null ? Prisma.JsonNull : (v as Prisma.InputJsonValue));

export const rewriteRepository = {
  async replaceAll(projectId: number, layers: RewriteLayers): Promise<void> {
    await prisma.$transaction([
      prisma.rewriteSet.deleteMany({ where: { projectId } }),
      prisma.rewriteSet.create({ data: { projectId, card: json(layers.card), brief: json(layers.brief), full: json(layers.full) } }),
    ]);
  },

  async setLayer(projectId: number, layer: RewriteLayer, value: unknown): Promise<void> {
    await prisma.rewriteSet.upsert({
      where: { projectId },
      create: { projectId, [layer]: json(value) },
      update: { [layer]: json(value) },
    });
  },

  find(projectId: number) {
    return prisma.rewriteSet.findUnique({ where: { projectId } });
  },
};
