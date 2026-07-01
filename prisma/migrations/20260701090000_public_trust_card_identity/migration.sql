ALTER TABLE "businesses"
ADD COLUMN "publicCardId" TEXT;

UPDATE "businesses"
SET "publicCardId" = 'LL-' || UPPER(SUBSTRING(MD5("id" || ':loyal-loop-public-card-v1') FROM 1 FOR 8))
WHERE "publicCardId" IS NULL;

ALTER TABLE "businesses"
ALTER COLUMN "publicCardId" SET NOT NULL;

CREATE UNIQUE INDEX "businesses_publicCardId_key"
ON "businesses"("publicCardId");
