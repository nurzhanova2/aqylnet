-- CreateEnum
CREATE TYPE "PersonaGroup" AS ENUM ('population', 'business', 'experts');

-- AlterTable
ALTER TABLE "LlmUsage" ADD COLUMN     "promptHash" VARCHAR(64),
ADD COLUMN     "scenarioVersion" TEXT;

-- AlterTable
ALTER TABLE "Persona" ADD COLUMN     "group" "PersonaGroup";

-- CreateTable
CREATE TABLE "PersonaSectionScore" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "personaId" INTEGER NOT NULL,
    "sectionId" INTEGER NOT NULL,
    "clarity" INTEGER,
    "reasons" INTEGER,
    "myAction" INTEGER,
    "rateSignal" INTEGER,
    "trust" INTEGER,
    "nullReasons" JSONB NOT NULL DEFAULT '{}',
    "terms" INTEGER NOT NULL,
    "termsFound" TEXT[],
    "termsUnclear" TEXT[],
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "read" TEXT NOT NULL,
    "unclear" TEXT[],
    "quote" TEXT NOT NULL,
    "quoteHelped" BOOLEAN,
    "quoteVerified" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaSectionScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaReading" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "personaId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "failReason" TEXT NOT NULL DEFAULT '',
    "mainTakeaway" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL DEFAULT '',
    "myAction" TEXT NOT NULL DEFAULT '',
    "extraUnclearWords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonaSectionScore_projectId_idx" ON "PersonaSectionScore"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaSectionScore_projectId_personaId_sectionId_key" ON "PersonaSectionScore"("projectId", "personaId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaReading_projectId_personaId_key" ON "PersonaReading"("projectId", "personaId");

-- AddForeignKey
ALTER TABLE "PersonaSectionScore" ADD CONSTRAINT "PersonaSectionScore_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaSectionScore" ADD CONSTRAINT "PersonaSectionScore_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaSectionScore" ADD CONSTRAINT "PersonaSectionScore_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "DocumentSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaReading" ADD CONSTRAINT "PersonaReading_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaReading" ADD CONSTRAINT "PersonaReading_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;
