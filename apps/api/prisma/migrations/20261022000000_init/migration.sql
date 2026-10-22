-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "districts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "languages" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "facilities" (
    "id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "device_id" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "district_id" TEXT,
    "languages" JSONB NOT NULL DEFAULT '[]',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "phone" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "capabilities" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "device_id" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "phone_number" TEXT,
    "facility_id" TEXT,
    "key_hex" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "activated_at" BIGINT,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activation_codes" (
    "code" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "expires_at" BIGINT NOT NULL,
    "used_at" BIGINT,

    CONSTRAINT "activation_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "households" (
    "id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "device_id" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "facility_id" TEXT,
    "community" TEXT NOT NULL,
    "head_name" TEXT NOT NULL,
    "landmark" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "consent_at" BIGINT,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "device_id" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "facility_id" TEXT,
    "household_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sex" TEXT,
    "dob" BIGINT,
    "edd" BIGINT,
    "delivery_date" BIGINT,
    "parity" INTEGER,
    "prior_complications" JSONB NOT NULL DEFAULT '[]',
    "birth_weight_g" INTEGER,
    "nhis_active" BOOLEAN NOT NULL DEFAULT false,
    "risk_flags" JSONB NOT NULL DEFAULT '[]',
    "dhis2_uid" TEXT,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "device_id" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "facility_id" TEXT,
    "client_id" TEXT NOT NULL,
    "protocol_id" TEXT NOT NULL,
    "visited_at" BIGINT NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "outcome" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "followup_due" BIGINT,
    "notes" TEXT,
    "muac_mm" INTEGER,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "device_id" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "facility_id" TEXT,
    "origin_device_id" TEXT NOT NULL,
    "short_id" TEXT NOT NULL,
    "client_id" TEXT,
    "visit_id" TEXT,
    "client_code" TEXT,
    "client_type" TEXT,
    "context" TEXT,
    "urgency" INTEGER,
    "danger_signs" JSONB NOT NULL DEFAULT '[]',
    "destination_facility_id" TEXT,
    "next_of_kin" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "delivered_via" TEXT,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_events" (
    "id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "device_id" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "referral_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "at" BIGINT NOT NULL,
    "source_device_id" TEXT NOT NULL,
    "via" TEXT NOT NULL,

    CONSTRAINT "referral_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_providers" (
    "id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "device_id" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "facility_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL DEFAULT '',
    "community" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "transport_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_requests" (
    "id" TEXT NOT NULL,
    "updated_at" BIGINT NOT NULL,
    "device_id" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "seq" BIGINT NOT NULL DEFAULT 0,
    "facility_id" TEXT,
    "referral_id" TEXT,
    "provider_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "scheduled_for" BIGINT,

    CONSTRAINT "transport_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" BIGSERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_at" BIGINT NOT NULL,
    "last_error" TEXT,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mapping_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "constants" JSONB NOT NULL DEFAULT '{}',
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "mapping_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "facility_id" TEXT NOT NULL,
    "template_id" TEXT,
    "source" TEXT NOT NULL,
    "filename" TEXT,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "counts" JSONB NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "rows" JSONB NOT NULL DEFAULT '[]',
    "created_ids" JSONB NOT NULL DEFAULT '{"households":[],"clients":[]}',
    "created_at" BIGINT NOT NULL,
    "committed_at" BIGINT,
    "undone_at" BIGINT,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_packs" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "language" TEXT,
    "district_id" TEXT,
    "version" INTEGER NOT NULL,
    "size" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "created_at" BIGINT NOT NULL,

    CONSTRAINT "content_packs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "districts_code_unique" ON "districts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "facilities_code_unique" ON "facilities"("code");

-- CreateIndex
CREATE INDEX "facilities_seq" ON "facilities"("seq");

-- CreateIndex
CREATE INDEX "facilities_district" ON "facilities"("district_id");

-- CreateIndex
CREATE INDEX "devices_seq" ON "devices"("seq");

-- CreateIndex
CREATE INDEX "activation_codes_device" ON "activation_codes"("device_id");

-- CreateIndex
CREATE INDEX "households_scope" ON "households"("facility_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "clients_dhis2_uid" ON "clients"("dhis2_uid");

-- CreateIndex
CREATE INDEX "clients_scope" ON "clients"("facility_id", "seq");

-- CreateIndex
CREATE INDEX "clients_household" ON "clients"("household_id");

-- CreateIndex
CREATE INDEX "visits_scope" ON "visits"("facility_id", "seq");

-- CreateIndex
CREATE INDEX "visits_client" ON "visits"("client_id", "visited_at");

-- CreateIndex
CREATE INDEX "referrals_scope" ON "referrals"("facility_id", "seq");

-- CreateIndex
CREATE INDEX "referrals_dest" ON "referrals"("destination_facility_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "referrals_key" ON "referrals"("origin_device_id", "short_id");

-- CreateIndex
CREATE INDEX "referral_events_referral" ON "referral_events"("referral_id");

-- CreateIndex
CREATE INDEX "referral_events_seq" ON "referral_events"("seq");

-- CreateIndex
CREATE INDEX "transport_providers_scope" ON "transport_providers"("facility_id", "seq");

-- CreateIndex
CREATE INDEX "transport_providers_phone" ON "transport_providers"("phone");

-- CreateIndex
CREATE INDEX "transport_requests_scope" ON "transport_requests"("facility_id", "seq");

-- CreateIndex
CREATE INDEX "transport_requests_provider" ON "transport_requests"("provider_id", "status");

-- CreateIndex
CREATE INDEX "jobs_due" ON "jobs"("status", "run_at");

-- CreateIndex
CREATE UNIQUE INDEX "mapping_templates_name_unique" ON "mapping_templates"("name");

-- CreateIndex
CREATE INDEX "import_batches_facility" ON "import_batches"("facility_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_packs_version" ON "content_packs"("kind", "language", "district_id", "version");

-- AddForeignKey
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "referrals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "facilities"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_template_id_mapping_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "mapping_templates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

