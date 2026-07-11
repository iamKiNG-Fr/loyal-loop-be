CREATE TYPE "ShortLinkKind" AS ENUM (
  'SHOP',
  'PRODUCT',
  'RECEIPT',
  'TRUST_CARD'
);

CREATE TABLE "short_links" (
  "id" TEXT NOT NULL,
  "code" VARCHAR(8) NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "kind" "ShortLinkKind" NOT NULL,
  "businessId" TEXT NOT NULL,
  "productId" TEXT,
  "receiptId" TEXT,
  "source" TEXT NOT NULL,
  "campaign" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),

  CONSTRAINT "short_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "short_links_code_key" ON "short_links"("code");
CREATE UNIQUE INDEX "short_links_fingerprint_key" ON "short_links"("fingerprint");
CREATE INDEX "short_links_businessId_createdAt_idx" ON "short_links"("businessId", "createdAt");
CREATE INDEX "short_links_expiresAt_idx" ON "short_links"("expiresAt");

ALTER TABLE "short_links"
  ADD CONSTRAINT "short_links_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "short_links"
  ADD CONSTRAINT "short_links_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "products"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "short_links"
  ADD CONSTRAINT "short_links_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "receipts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
