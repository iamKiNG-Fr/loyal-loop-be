-- Batch 22 follow-up: idempotent, ordered Cloudinary moderation notifications.

ALTER TABLE "media_assets"
  ADD COLUMN "moderationEventId" TEXT,
  ADD COLUMN "moderationNotifiedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "media_assets_moderationEventId_key"
  ON "media_assets"("moderationEventId");
