-- Persisted module flows and configurable public shop presentation.

ALTER TABLE "business_preferences"
ADD COLUMN "tickerItems" TEXT[] NOT NULL DEFAULT ARRAY[
  'New drops',
  'Trusted receipts',
  'Delivery updates',
  'Customer favourites'
]::TEXT[];

ALTER TABLE "sale_items"
ADD COLUMN "catalogUnitPrice" DECIMAL(12,2),
ADD COLUMN "priceAdjustmentReason" TEXT;

UPDATE "sale_items"
SET "catalogUnitPrice" = "unitPrice"
WHERE "catalogUnitPrice" IS NULL;

ALTER TABLE "deliveries"
ADD COLUMN "googlePlaceId" TEXT,
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;
