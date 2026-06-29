-- Customer delivery addresses and immutable order-request address snapshots

CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "customerId" TEXT,
    "label" TEXT,
    "recipientName" TEXT,
    "phone" TEXT,
    "address" TEXT NOT NULL,
    "googlePlaceId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "deliveryNotes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "order_requests"
  ADD COLUMN "fulfillment" "FulfillmentType" NOT NULL DEFAULT 'ARRANGE_LATER',
  ADD COLUMN "customerAddressId" TEXT,
  ADD COLUMN "deliveryAddress" TEXT,
  ADD COLUMN "deliveryPlaceId" TEXT,
  ADD COLUMN "deliveryLatitude" DOUBLE PRECISION,
  ADD COLUMN "deliveryLongitude" DOUBLE PRECISION,
  ADD COLUMN "deliveryNotes" TEXT;

CREATE INDEX "customer_addresses_customerAccountId_isDefault_idx" ON "customer_addresses"("customerAccountId", "isDefault");
CREATE INDEX "customer_addresses_customerId_idx" ON "customer_addresses"("customerId");
CREATE INDEX "order_requests_customerAddressId_idx" ON "order_requests"("customerAddressId");

ALTER TABLE "customer_addresses"
  ADD CONSTRAINT "customer_addresses_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_addresses"
  ADD CONSTRAINT "customer_addresses_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_requests"
  ADD CONSTRAINT "order_requests_customerAddressId_fkey"
  FOREIGN KEY ("customerAddressId") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
