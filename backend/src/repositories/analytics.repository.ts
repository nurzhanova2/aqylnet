import { Prisma, AnalyticsReport } from '@prisma/client';
import { prisma } from '../config/prisma';
import { UpsertAnalyticsInput, AnalyticsExtras } from '../validators/analytics.validator';

// What actually gets written: the request shape, except that `extras` is the
// full storage shape including overallScore. The service computes that field;
// it is never accepted from a client (see AnalyticsExtrasInputSchema).
export type AnalyticsWriteInput =
  Omit<UpsertAnalyticsInput, 'extras'> & { extras: AnalyticsExtras };

// JSON fields require explicit cast to Prisma.InputJsonValue
function toInputJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

export const analyticsRepository = {
  findByProjectId(projectId: number): Promise<AnalyticsReport | null> {
    return prisma.analyticsReport.findUnique({ where: { projectId } });
  },

  upsert(projectId: number, data: AnalyticsWriteInput): Promise<AnalyticsReport> {
    const jsonFields = {
      conclusions:     toInputJson(data.conclusions),
      topicBars:       toInputJson(data.topicBars),
      positives:       toInputJson(data.positives),
      altParagraphs:   toInputJson(data.altParagraphs),
      extras:          toInputJson(data.extras),
    };

    const scalarFields = {
      risks:           data.risks,
      recommendations: data.recommendations,
    };

    return prisma.analyticsReport.upsert({
      where:  { projectId },
      create: { projectId, ...jsonFields, ...scalarFields },
      update: { ...jsonFields, ...scalarFields },
    });
  },
};
