-- CreateTable
CREATE TABLE "DocumentSection" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "order" INTEGER NOT NULL,
    "heading" TEXT,
    "text" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,

    CONSTRAINT "DocumentSection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSection_projectId_order_key" ON "DocumentSection"("projectId", "order");

-- AddForeignKey
ALTER TABLE "DocumentSection" ADD CONSTRAINT "DocumentSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

