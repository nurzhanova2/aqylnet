-- CreateTable
CREATE TABLE "RewriteSet" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "card" JSONB,
    "brief" JSONB,
    "full" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewriteSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RewriteSet_projectId_key" ON "RewriteSet"("projectId");

-- AddForeignKey
ALTER TABLE "RewriteSet" ADD CONSTRAINT "RewriteSet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
