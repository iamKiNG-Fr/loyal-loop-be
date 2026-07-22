CREATE TYPE "DeliveryEligibilityStatus" AS ENUM ('ELIGIBLE', 'NEEDS_REVIEW', 'NOT_APPLICABLE');
CREATE TYPE "OrderTermChangeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'SUPERSEDED');

ALTER TABLE "business_preferences"
ALTER COLUMN "allowedPaymentMethods"
SET DEFAULT ARRAY['BANK_TRANSFER'::"PaymentMethod", 'PAY_ON_DELIVERY'::"PaymentMethod", 'CASH'::"PaymentMethod"];

-- ARRANGE_SEPARATELY was previously enabled for every business by default.
-- Remove that implicit opt-in; a business can explicitly enable it again.
UPDATE "business_preferences"
SET "allowedPaymentMethods" = array_remove("allowedPaymentMethods", 'ARRANGE_SEPARATELY'::"PaymentMethod"),
    "defaultPaymentMethod" = CASE
      WHEN "defaultPaymentMethod" = 'ARRANGE_SEPARATELY'::"PaymentMethod" THEN NULL
      ELSE "defaultPaymentMethod"
    END
WHERE "allowedPaymentMethods" @> ARRAY['ARRANGE_SEPARATELY'::"PaymentMethod"];

UPDATE "business_preferences"
SET "allowedPaymentMethods" = ARRAY['BANK_TRANSFER'::"PaymentMethod"]
WHERE cardinality("allowedPaymentMethods") = 0;

ALTER TABLE "business_preferences"
ADD COLUMN "allowedFulfillmentMethods" "FulfillmentType"[] NOT NULL
  DEFAULT ARRAY['DELIVERY'::"FulfillmentType", 'PICKUP'::"FulfillmentType"],
ADD COLUMN "deliveryStates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "customer_addresses"
ADD COLUMN "countryCode" TEXT,
ADD COLUMN "administrativeArea1" TEXT,
ADD COLUMN "locality" TEXT;

ALTER TABLE "order_requests"
ADD COLUMN "agreedFulfillment" "FulfillmentType",
ADD COLUMN "agreedPaymentMethod" "PaymentMethod",
ADD COLUMN "deliveryCountryCode" TEXT,
ADD COLUMN "deliveryAdministrativeArea1" TEXT,
ADD COLUMN "deliveryLocality" TEXT,
ADD COLUMN "deliveryEligibility" "DeliveryEligibilityStatus" NOT NULL DEFAULT 'NOT_APPLICABLE';

UPDATE "order_requests"
SET "deliveryEligibility" = 'NEEDS_REVIEW'::"DeliveryEligibilityStatus"
WHERE "fulfillment" = 'DELIVERY'::"FulfillmentType";

CREATE TABLE "order_request_term_changes" (
  "id" TEXT NOT NULL,
  "orderRequestId" TEXT NOT NULL,
  "requestedByUserId" TEXT,
  "customerAccountId" TEXT,
  "previousFulfillment" "FulfillmentType" NOT NULL,
  "previousPaymentMethod" "PaymentMethod",
  "proposedFulfillment" "FulfillmentType",
  "proposedPaymentMethod" "PaymentMethod",
  "resolvedFulfillment" "FulfillmentType",
  "resolvedPaymentMethod" "PaymentMethod",
  "reason" TEXT NOT NULL,
  "status" "OrderTermChangeStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "order_request_term_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_request_term_changes_orderRequestId_status_createdAt_idx"
ON "order_request_term_changes"("orderRequestId", "status", "createdAt");

ALTER TABLE "order_request_term_changes"
ADD CONSTRAINT "order_request_term_changes_orderRequestId_fkey"
FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
