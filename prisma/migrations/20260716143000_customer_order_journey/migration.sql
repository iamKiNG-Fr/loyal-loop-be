ALTER TABLE "business_preferences"
ADD COLUMN "deliveryAreas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "customer_accounts"
ADD COLUMN "alternatePhone" TEXT,
ADD COLUMN "birthday" DATE,
ADD COLUMN "gender" TEXT,
ADD COLUMN "socials" JSONB;

ALTER TABLE "customer_cart_groups"
ADD COLUMN "isGift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recipientName" TEXT,
ADD COLUMN "recipientPhone" TEXT,
ADD COLUMN "whatsappUpdatesConsent" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "order_requests"
ADD COLUMN "cancellationReasonCode" TEXT,
ADD COLUMN "cancellationReason" TEXT,
ADD COLUMN "canceledBy" TEXT;

CREATE TABLE "order_request_share_tokens" (
  "id" TEXT NOT NULL,
  "orderRequestId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "order_request_share_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_request_share_tokens_tokenHash_key"
ON "order_request_share_tokens"("tokenHash");

CREATE INDEX "order_request_share_tokens_orderRequestId_createdAt_idx"
ON "order_request_share_tokens"("orderRequestId", "createdAt");

ALTER TABLE "order_request_share_tokens"
ADD CONSTRAINT "order_request_share_tokens_orderRequestId_fkey"
FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
