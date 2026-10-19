ALTER TYPE "NotificationType" ADD VALUE 'REVIEW';

ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT;

ALTER TABLE "User" ADD COLUMN     "reviewReminders" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
