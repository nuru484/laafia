-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_facility_id_facilities_id_fk";

-- DropForeignKey
ALTER TABLE "import_batches" DROP CONSTRAINT "import_batches_template_id_mapping_templates_id_fk";

-- DropForeignKey
ALTER TABLE "content_packs" DROP CONSTRAINT "content_packs_district_id_districts_id_fk";

-- DropForeignKey
ALTER TABLE "map_builds" DROP CONSTRAINT "map_builds_district_id_fkey";

-- DropForeignKey
ALTER TABLE "map_builds" DROP CONSTRAINT "map_builds_pack_id_fkey";

-- DropIndex
DROP INDEX "clients_dhis2_uid";

-- AlterTable
ALTER TABLE "districts" DROP COLUMN "languages";

-- AlterTable
ALTER TABLE "facilities" DROP COLUMN "languages";

-- AlterTable
ALTER TABLE "clients" DROP COLUMN "dhis2_uid";

-- DropTable
DROP TABLE "transport_providers";

-- DropTable
DROP TABLE "transport_requests";

-- DropTable
DROP TABLE "mapping_templates";

-- DropTable
DROP TABLE "import_batches";

-- DropTable
DROP TABLE "content_packs";

-- DropTable
DROP TABLE "map_builds";

-- DropTable
DROP TABLE "content_clips";

-- DropTable
DROP TABLE "export_runs";


-- Volunteer phones and hand-carried referrals are no longer part of the app.
DELETE FROM "referral_events" WHERE "status" = 'carrying';
DELETE FROM "devices" WHERE "role" = 'volunteer';
