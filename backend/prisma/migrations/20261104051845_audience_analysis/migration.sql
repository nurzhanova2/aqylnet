-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('press_release', 'mpr', 'fsr', 'analytical_note', 'other');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "docType" "DocType",
ADD COLUMN     "intendedAudience" "PersonaGroup"[],
ADD COLUMN     "publishedAt" DATE;

-- CreateTable
CREATE TABLE "AudienceAnalysis" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "scoresAt" TIMESTAMP(3) NOT NULL,
    "reference" JSONB NOT NULL,
    "verdicts" JSONB NOT NULL,
    "missing" JSONB NOT NULL,
    "versions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudienceAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AudienceAnalysis_projectId_key" ON "AudienceAnalysis"("projectId");

-- AddForeignKey
ALTER TABLE "AudienceAnalysis" ADD CONSTRAINT "AudienceAnalysis_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
