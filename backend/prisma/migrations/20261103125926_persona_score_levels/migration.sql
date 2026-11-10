-- AlterTable
ALTER TABLE "PersonaReading" ADD COLUMN     "levels" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "rateSignal" INTEGER;

-- AlterTable
ALTER TABLE "PersonaSectionScore" ADD COLUMN     "levels" JSONB NOT NULL DEFAULT '{}';
