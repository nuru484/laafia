CREATE TABLE "content_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"language" text,
	"district_id" text,
	"version" integer NOT NULL,
	"size" bigint NOT NULL,
	"sha256" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "districts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"facility_id" text NOT NULL,
	"template_id" text,
	"source" text NOT NULL,
	"filename" text,
	"status" text DEFAULT 'preview' NOT NULL,
	"counts" jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_ids" jsonb DEFAULT '{"households":[],"clients":[]}'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"committed_at" bigint,
	"undone_at" bigint
);
--> statement-breakpoint
CREATE TABLE "mapping_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"mapping" jsonb NOT NULL,
	"constants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "mapping_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "dhis2_uid" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "district_id" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "languages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "content_packs" ADD CONSTRAINT "content_packs_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_template_id_mapping_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."mapping_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_packs_version" ON "content_packs" USING btree ("kind","language","district_id","version");--> statement-breakpoint
CREATE INDEX "import_batches_facility" ON "import_batches" USING btree ("facility_id","created_at");--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_dhis2_uid" ON "clients" USING btree ("dhis2_uid") WHERE dhis2_uid is not null;--> statement-breakpoint
CREATE INDEX "facilities_district" ON "facilities" USING btree ("district_id");