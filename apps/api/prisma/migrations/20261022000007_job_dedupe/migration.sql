-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "dedupe_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupe_key" ON "jobs"("dedupe_key");
