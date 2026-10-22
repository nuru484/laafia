-- CreateTable
CREATE TABLE "map_builds" (
    "id" TEXT NOT NULL,
    "district_id" TEXT NOT NULL,
    "bbox" DOUBLE PRECISION[],
    "status" TEXT NOT NULL,
    "error" TEXT,
    "pack_id" TEXT,
    "started_at" BIGINT NOT NULL,
    "finished_at" BIGINT,

    CONSTRAINT "map_builds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "map_builds_district_id_started_at_idx" ON "map_builds"("district_id", "started_at");

-- CreateIndex
CREATE INDEX "map_builds_pack_id_idx" ON "map_builds"("pack_id");

-- AddForeignKey
ALTER TABLE "map_builds" ADD CONSTRAINT "map_builds_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "map_builds" ADD CONSTRAINT "map_builds_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "content_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
