ALTER TYPE "MediaPurpose" ADD VALUE 'USER_AVATAR';

ALTER TABLE "users" ADD COLUMN "avatarAssetId" TEXT;

CREATE UNIQUE INDEX "users_avatarAssetId_key" ON "users"("avatarAssetId");

ALTER TABLE "users"
  ADD CONSTRAINT "users_avatarAssetId_fkey"
  FOREIGN KEY ("avatarAssetId")
  REFERENCES "media_assets"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
