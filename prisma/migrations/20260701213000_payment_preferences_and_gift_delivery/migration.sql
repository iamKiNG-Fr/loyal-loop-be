-- Payment defaults and immutable gift-recipient snapshots.

ALTER TABLE "business_preferences"
ADD COLUMN "protectedPaymentEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "feedbackResponseTime" TEXT NOT NULL DEFAULT 'Within one business day';

ALTER TABLE "customer_accounts"
ADD COLUMN "name" TEXT;

ALTER TABLE "order_requests"
ADD COLUMN "isGift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recipientName" TEXT,
ADD COLUMN "recipientPhone" TEXT;

ALTER TABLE "sales"
ADD COLUMN "protectedPayment" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "deliveries"
ADD COLUMN "isGift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "recipientName" TEXT,
ADD COLUMN "recipientPhone" TEXT;
