-- AlterEnum
ALTER TYPE "MediaPurpose" ADD VALUE 'RENTAL_EVIDENCE';

-- AlterTable
ALTER TABLE "business_preferences" ADD COLUMN     "rentalLateRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "rentalLateUnit" TEXT NOT NULL DEFAULT 'DAY',
ADD COLUMN     "rentalPolicy" TEXT;

-- AlterTable
ALTER TABLE "customer_cart_items" ADD COLUMN     "rentalEndAt" TIMESTAMP(3),
ADD COLUMN     "rentalStartAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "order_request_items" ADD COLUMN     "rental" JSONB;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "rental" JSONB,
ADD COLUMN     "rentalEndAt" TIMESTAMP(3),
ADD COLUMN     "rentalLateFee" DECIMAL(12,2),
ADD COLUMN     "rentalReceiveAssetId" TEXT,
ADD COLUMN     "rentalDispatchedAt" TIMESTAMP(3),
ADD COLUMN     "rentalReceivedAt" TIMESTAMP(3),
ADD COLUMN     "rentalReturnAssetId" TEXT,
ADD COLUMN     "rentalReturnedAt" TIMESTAMP(3),
ADD COLUMN     "rentalStartAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_rentalReceiveAssetId_key" ON "sale_items"("rentalReceiveAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_rentalReturnAssetId_key" ON "sale_items"("rentalReturnAssetId");

-- CreateIndex
CREATE INDEX "sale_items_productId_rentalStartAt_rentalEndAt_idx" ON "sale_items"("productId", "rentalStartAt", "rentalEndAt");

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_rentalReceiveAssetId_fkey" FOREIGN KEY ("rentalReceiveAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_rentalReturnAssetId_fkey" FOREIGN KEY ("rentalReturnAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

