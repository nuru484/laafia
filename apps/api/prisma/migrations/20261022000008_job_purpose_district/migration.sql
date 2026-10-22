-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "district_id" TEXT,
ADD COLUMN     "purpose" TEXT;

-- CreateIndex
CREATE INDEX "jobs_district" ON "jobs"("district_id", "created_at");
