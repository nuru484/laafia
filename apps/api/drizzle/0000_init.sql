CREATE TABLE "activation_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"used_at" bigint
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"facility_id" text,
	"household_id" text NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"sex" text,
	"dob" bigint,
	"edd" bigint,
	"delivery_date" bigint,
	"parity" integer,
	"prior_complications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"birth_weight_g" integer,
	"nhis_active" boolean DEFAULT false NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"role" text NOT NULL,
	"user_name" text NOT NULL,
	"phone_number" text,
	"facility_id" text,
	"key_hex" text,
	"active" boolean DEFAULT true NOT NULL,
	"activated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"level" text NOT NULL,
	"phone" text,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "facilities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"facility_id" text,
	"community" text NOT NULL,
	"head_name" text NOT NULL,
	"landmark" text DEFAULT '' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"consent_at" bigint
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_at" bigint NOT NULL,
	"last_error" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_events" (
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"referral_id" text NOT NULL,
	"status" text NOT NULL,
	"at" bigint NOT NULL,
	"source_device_id" text NOT NULL,
	"via" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"facility_id" text,
	"origin_device_id" text NOT NULL,
	"short_id" text NOT NULL,
	"client_id" text,
	"visit_id" text,
	"client_code" text,
	"client_type" text,
	"context" text,
	"urgency" integer,
	"danger_signs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"destination_facility_id" text,
	"next_of_kin" text,
	"status" text DEFAULT 'created' NOT NULL,
	"delivered_via" text
);
--> statement-breakpoint
CREATE TABLE "transport_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"facility_id" text,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"vehicle" text DEFAULT '' NOT NULL,
	"community" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"facility_id" text,
	"referral_id" text,
	"provider_id" text NOT NULL,
	"status" text NOT NULL,
	"scheduled_for" bigint
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" text PRIMARY KEY NOT NULL,
	"updated_at" bigint NOT NULL,
	"device_id" text,
	"deleted" boolean DEFAULT false NOT NULL,
	"seq" bigint DEFAULT 0 NOT NULL,
	"facility_id" text,
	"client_id" text NOT NULL,
	"protocol_id" text NOT NULL,
	"visited_at" bigint NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"outcome" text NOT NULL,
	"rule_id" text NOT NULL,
	"followup_due" bigint,
	"notes" text,
	"muac_mm" integer
);
--> statement-breakpoint
ALTER TABLE "activation_codes" ADD CONSTRAINT "activation_codes_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_events" ADD CONSTRAINT "referral_events_referral_id_referrals_id_fk" FOREIGN KEY ("referral_id") REFERENCES "public"."referrals"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "activation_codes_device" ON "activation_codes" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "clients_scope" ON "clients" USING btree ("facility_id","seq");--> statement-breakpoint
CREATE INDEX "clients_household" ON "clients" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "devices_seq" ON "devices" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "facilities_seq" ON "facilities" USING btree ("seq");--> statement-breakpoint
CREATE INDEX "households_scope" ON "households" USING btree ("facility_id","seq");--> statement-breakpoint
CREATE INDEX "jobs_due" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "referral_events_referral" ON "referral_events" USING btree ("referral_id");--> statement-breakpoint
CREATE INDEX "referral_events_seq" ON "referral_events" USING btree ("seq");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_key" ON "referrals" USING btree ("origin_device_id","short_id");--> statement-breakpoint
CREATE INDEX "referrals_scope" ON "referrals" USING btree ("facility_id","seq");--> statement-breakpoint
CREATE INDEX "referrals_dest" ON "referrals" USING btree ("destination_facility_id","seq");--> statement-breakpoint
CREATE INDEX "transport_providers_scope" ON "transport_providers" USING btree ("facility_id","seq");--> statement-breakpoint
CREATE INDEX "transport_providers_phone" ON "transport_providers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "transport_requests_scope" ON "transport_requests" USING btree ("facility_id","seq");--> statement-breakpoint
CREATE INDEX "transport_requests_provider" ON "transport_requests" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "visits_scope" ON "visits" USING btree ("facility_id","seq");--> statement-breakpoint
CREATE INDEX "visits_client" ON "visits" USING btree ("client_id","visited_at");