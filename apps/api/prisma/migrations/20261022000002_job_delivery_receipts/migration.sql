-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "delivered_at" BIGINT,
ADD COLUMN     "delivery_reason" TEXT,
ADD COLUMN     "delivery_status" TEXT;
