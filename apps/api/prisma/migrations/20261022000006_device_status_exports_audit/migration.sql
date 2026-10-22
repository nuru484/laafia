-- CreateTable
CREATE TABLE "device_status" (
    "device_id" TEXT NOT NULL,
    "last_sync_at" BIGINT NOT NULL,
    "app_version" TEXT,

    CONSTRAINT "device_status_pkey" PRIMARY KEY ("device_id")
);

-- CreateTable
CREATE TABLE "export_runs" (
    "id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dry_run" BOOLEAN NOT NULL,
    "actor" TEXT NOT NULL,
    "at" BIGINT NOT NULL,
    "tracked_entities" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "export_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "at" BIGINT NOT NULL,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "district_id" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_runs_facility_period" ON "export_runs"("facility_id", "period");

-- CreateIndex
CREATE INDEX "audit_events_at" ON "audit_events"("at");

-- CreateIndex
CREATE INDEX "audit_events_district" ON "audit_events"("district_id", "at");
