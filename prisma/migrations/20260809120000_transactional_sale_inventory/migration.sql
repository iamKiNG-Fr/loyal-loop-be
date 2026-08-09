CREATE TYPE "SaleItemInventorySource" AS ENUM ('PRODUCT', 'VARIANT');

ALTER TABLE "sales"
ADD COLUMN "inventoryRestoredAt" TIMESTAMP(3);

ALTER TABLE "sale_items"
ADD COLUMN "variantId" TEXT,
ADD COLUMN "variantName" TEXT,
ADD COLUMN "variantSnapshot" JSONB,
ADD COLUMN "inventorySource" "SaleItemInventorySource";

CREATE INDEX "sale_items_variantId_idx" ON "sale_items"("variantId");

ALTER TABLE "sale_items"
ADD CONSTRAINT "sale_items_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "product_variants"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
