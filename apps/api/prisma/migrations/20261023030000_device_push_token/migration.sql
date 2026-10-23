-- The phone's Expo push address: referrals and status changes reach it at once when it has internet.
ALTER TABLE "devices" ADD COLUMN "push_token" TEXT;
