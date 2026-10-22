-- Booking texts and reminders go to the client's own phone.
ALTER TABLE "clients" ADD COLUMN "phone" TEXT;
