CREATE TYPE "FulfillmentJourneyMethod" AS ENUM ('SHOP_DELIVERY', 'CUSTOMER_PICKUP', 'CUSTOMER_RIDER');
CREATE TYPE "BusinessCustomerReportReason" AS ENUM ('FAKE_PAYMENT_PROOF', 'FRAUD_OR_SCAM', 'ABUSE_OR_HARASSMENT', 'PRIVACY_OR_SAFETY', 'REPEATED_BROKEN_AGREEMENTS', 'OTHER');

ALTER TYPE "MediaPurpose" ADD VALUE 'DELIVERY_HANDOFF';

ALTER TABLE "businesses"
ADD COLUMN "slugChangedAt" TIMESTAMP(3);

ALTER TABLE "order_requests"
ADD COLUMN "pickupMethod" "FulfillmentJourneyMethod";

ALTER TABLE "deliveries"
ADD COLUMN "journeyMethod" "FulfillmentJourneyMethod" NOT NULL DEFAULT 'SHOP_DELIVERY',
ADD COLUMN "pickupLocationId" TEXT,
ADD COLUMN "pickupLabel" TEXT,
ADD COLUMN "pickupAddress" TEXT,
ADD COLUMN "pickupGooglePlaceId" TEXT,
ADD COLUMN "pickupLatitude" DOUBLE PRECISION,
ADD COLUMN "pickupLongitude" DOUBLE PRECISION,
ADD COLUMN "handoffAssetId" TEXT,
ADD COLUMN "riderDetailsAddedAt" TIMESTAMP(3),
ADD COLUMN "handedOffAt" TIMESTAMP(3),
ADD COLUMN "handoffCodeIssuedAt" TIMESTAMP(3);

UPDATE "deliveries" AS delivery
SET "journeyMethod" = 'CUSTOMER_PICKUP'
FROM "sales" AS sale
WHERE delivery."saleId" = sale."id"
  AND sale."fulfillment" = 'PICKUP';

CREATE TABLE "business_slug_history" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "changedByUserId" TEXT,
  "changedByAdminId" TEXT,
  "reason" TEXT,
  "replacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "business_slug_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_pickup_locations" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "googlePlaceId" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_pickup_locations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_customer_reports" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "reportedByUserId" TEXT NOT NULL,
  "saleId" TEXT,
  "reason" "BusinessCustomerReportReason" NOT NULL,
  "details" TEXT,
  "status" "CustomerReportStatus" NOT NULL DEFAULT 'OPEN',
  "reviewedByAdminId" TEXT,
  "reviewNotes" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "business_customer_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_slug_history_slug_key" ON "business_slug_history"("slug");
CREATE INDEX "business_slug_history_businessId_replacedAt_idx" ON "business_slug_history"("businessId", "replacedAt");
CREATE INDEX "business_pickup_locations_businessId_isActive_isDefault_idx" ON "business_pickup_locations"("businessId", "isActive", "isDefault");
CREATE INDEX "business_customer_reports_businessId_status_createdAt_idx" ON "business_customer_reports"("businessId", "status", "createdAt");
CREATE INDEX "business_customer_reports_customerId_createdAt_idx" ON "business_customer_reports"("customerId", "createdAt");
CREATE INDEX "business_customer_reports_status_createdAt_idx" ON "business_customer_reports"("status", "createdAt");
CREATE INDEX "deliveries_pickupLocationId_idx" ON "deliveries"("pickupLocationId");

ALTER TABLE "business_slug_history" ADD CONSTRAINT "business_slug_history_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_slug_history" ADD CONSTRAINT "business_slug_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_slug_history" ADD CONSTRAINT "business_slug_history_changedByAdminId_fkey" FOREIGN KEY ("changedByAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_pickup_locations" ADD CONSTRAINT "business_pickup_locations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_customer_reports" ADD CONSTRAINT "business_customer_reports_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_customer_reports" ADD CONSTRAINT "business_customer_reports_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "business_customer_reports" ADD CONSTRAINT "business_customer_reports_reportedByUserId_fkey" FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "business_customer_reports" ADD CONSTRAINT "business_customer_reports_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "business_customer_reports" ADD CONSTRAINT "business_customer_reports_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "business_pickup_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_handoffAssetId_fkey" FOREIGN KEY ("handoffAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
