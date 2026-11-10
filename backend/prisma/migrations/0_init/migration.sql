-- CreateTable
CREATE TABLE "Persona" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "age" TEXT NOT NULL,
    "dot" TEXT NOT NULL,
    "seatL" TEXT NOT NULL,
    "seatT" TEXT NOT NULL,
    "thinking" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "criticality" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "interests" TEXT[],
    "reasoning" TEXT NOT NULL,
    "avatarIdx" INTEGER NOT NULL,
    "look" JSONB,
    "city" TEXT NOT NULL DEFAULT '',
    "education" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "employerType" TEXT NOT NULL DEFAULT '',
    "income" TEXT NOT NULL DEFAULT '',
    "openness" TEXT NOT NULL DEFAULT '',
    "decisionMaking" TEXT NOT NULL DEFAULT '',
    "stance" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT '',
    "fears" TEXT NOT NULL DEFAULT '',
    "personalSituation" TEXT NOT NULL DEFAULT '',
    "speechTone" TEXT NOT NULL DEFAULT '',
    "argumentation" TEXT NOT NULL DEFAULT '',
    "responseLength" TEXT NOT NULL DEFAULT 'Средний',
    "typicalPhrases" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaContext" (
    "id" SERIAL NOT NULL,
    "personaId" INTEGER NOT NULL,
    "src" TEXT NOT NULL,
    "quote" TEXT NOT NULL,

    CONSTRAINT "PersonaContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'Round Table',
    "iterations" INTEGER NOT NULL DEFAULT 5,
    "currentIteration" INTEGER NOT NULL DEFAULT 0,
    "moderator" BOOLEAN NOT NULL DEFAULT true,
    "goal" TEXT NOT NULL DEFAULT 'risk_search',
    "intendedMessages" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'setup',
    "documentText" TEXT,
    "documentFile" TEXT,
    "documentFileName" TEXT,
    "llmModel" TEXT NOT NULL DEFAULT 'GPT-4o',
    "ownerKey" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPersona" (
    "projectId" INTEGER NOT NULL,
    "personaId" INTEGER NOT NULL,
    "stanceOverride" TEXT,
    "reasoningOverride" TEXT,
    "priorityOverride" TEXT,
    "fearsOverride" TEXT,
    "thinkingOverride" TEXT,

    CONSTRAINT "ProjectPersona_pkey" PRIMARY KEY ("projectId","personaId")
);

-- CreateTable
CREATE TABLE "TimelineMessage" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "personaId" INTEGER,
    "speakerType" TEXT NOT NULL DEFAULT 'persona',
    "n" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "time" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dialog" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "fromPersonaId" INTEGER NOT NULL,
    "toPersonaId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dialog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionSummary" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "mood" TEXT NOT NULL,
    "moodEmoji" TEXT NOT NULL,
    "conclusion" TEXT NOT NULL,
    "topics" TEXT[],
    "risks" TEXT[],
    "improves" TEXT[],

    CONSTRAINT "DiscussionSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsReport" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "conclusions" JSONB NOT NULL,
    "topicBars" JSONB NOT NULL,
    "risks" TEXT[],
    "positives" JSONB NOT NULL,
    "recommendations" TEXT[],
    "altParagraphs" JSONB NOT NULL,
    "extras" JSONB,

    CONSTRAINT "AnalyticsReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER,
    "scenario" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Project_ownerKey_createdAt_idx" ON "Project"("ownerKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineMessage_projectId_n_key" ON "TimelineMessage"("projectId", "n");

-- CreateIndex
CREATE UNIQUE INDEX "DiscussionSummary_projectId_key" ON "DiscussionSummary"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsReport_projectId_key" ON "AnalyticsReport"("projectId");

-- CreateIndex
CREATE INDEX "LlmUsage_createdAt_idx" ON "LlmUsage"("createdAt");

-- CreateIndex
CREATE INDEX "LlmUsage_scenario_createdAt_idx" ON "LlmUsage"("scenario", "createdAt");

-- CreateIndex
CREATE INDEX "LlmUsage_projectId_idx" ON "LlmUsage"("projectId");

-- AddForeignKey
ALTER TABLE "PersonaContext" ADD CONSTRAINT "PersonaContext_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPersona" ADD CONSTRAINT "ProjectPersona_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPersona" ADD CONSTRAINT "ProjectPersona_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineMessage" ADD CONSTRAINT "TimelineMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimelineMessage" ADD CONSTRAINT "TimelineMessage_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "Persona"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dialog" ADD CONSTRAINT "Dialog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dialog" ADD CONSTRAINT "Dialog_fromPersonaId_fkey" FOREIGN KEY ("fromPersonaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dialog" ADD CONSTRAINT "Dialog_toPersonaId_fkey" FOREIGN KEY ("toPersonaId") REFERENCES "Persona"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionSummary" ADD CONSTRAINT "DiscussionSummary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsReport" ADD CONSTRAINT "AnalyticsReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

