-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('PERCENTAGE', 'FIXED_PRICE');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PromotionReservationStatus" AS ENUM ('RESERVED', 'REDEEMED', 'RELEASED', 'EXPIRED');

-- AlterTable
ALTER TABLE "order_request_items" ADD COLUMN     "originalUnitPrice" DECIMAL(12,2),
ADD COLUMN     "promotionId" TEXT,
ADD COLUMN     "promotionSnapshot" JSONB;

-- CreateTable
CREATE TABLE "product_promotions" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "name" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "percentage" INTEGER,
    "promotionalPrice" DECIMAL(12,2),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "claimLimit" INTEGER,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "reservationMinutes" INTEGER NOT NULL DEFAULT 2880,
    "status" "PromotionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_reservations" (
    "id" TEXT NOT NULL,
    "promotionId" TEXT NOT NULL,
    "orderRequestId" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "customerKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "PromotionReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "promotion_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_promotions_businessId_status_startsAt_endsAt_idx" ON "product_promotions"("businessId", "status", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "product_promotions_productId_variantId_status_idx" ON "product_promotions"("productId", "variantId", "status");

-- CreateIndex
CREATE INDEX "promotion_reservations_promotionId_status_expiresAt_idx" ON "promotion_reservations"("promotionId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "promotion_reservations_promotionId_customerKey_status_idx" ON "promotion_reservations"("promotionId", "customerKey", "status");

-- CreateIndex
CREATE INDEX "promotion_reservations_orderRequestId_idx" ON "promotion_reservations"("orderRequestId");

-- CreateIndex
CREATE INDEX "order_request_items_promotionId_idx" ON "order_request_items"("promotionId");

-- AddForeignKey
ALTER TABLE "product_promotions" ADD CONSTRAINT "product_promotions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_promotions" ADD CONSTRAINT "product_promotions_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_promotions" ADD CONSTRAINT "product_promotions_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_reservations" ADD CONSTRAINT "promotion_reservations_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "product_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_reservations" ADD CONSTRAINT "promotion_reservations_orderRequestId_fkey" FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_reservations" ADD CONSTRAINT "promotion_reservations_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_promotionId_fkey" FOREIGN KEY ("promotionId") REFERENCES "product_promotions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
