-- AlterTable
ALTER TABLE "referrals" ADD COLUMN     "onward_referral_id" TEXT,
ADD COLUMN     "onward_status" TEXT,
ADD COLUMN     "parent_referral_id" TEXT;

-- CreateIndex
CREATE INDEX "referrals_parent" ON "referrals"("parent_referral_id");
