-- Social-first shop launch moments. Existing businesses keep their current
-- status; only newly created businesses use the SETTING_UP default.

CREATE TYPE "LaunchTemplate" AS ENUM (
  'SHOP_LOADING',
  'COUNTDOWN_DROP',
  'OPENING_TONIGHT',
  'FIRST_DROP'
);

ALTER TABLE "businesses"
  ALTER COLUMN "storeStatus" SET DEFAULT 'SETTING_UP',
  ADD COLUMN "launchAt" TIMESTAMP(3),
  ADD COLUMN "launchTimezone" TEXT,
  ADD COLUMN "launchTemplate" "LaunchTemplate" NOT NULL DEFAULT 'SHOP_LOADING',
  ADD COLUMN "launchMessage" TEXT,
  ADD COLUMN "launchProductId" TEXT,
  ADD COLUMN "launchAutoOpen" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "launchShareVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "launchedAt" TIMESTAMP(3);

ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_launchProductId_fkey"
  FOREIGN KEY ("launchProductId")
  REFERENCES "products"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "businesses_storeStatus_launchAt_idx"
  ON "businesses"("storeStatus", "launchAt");
