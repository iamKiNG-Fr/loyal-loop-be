-- Additive owner attention, meaningful-work streak, push-subscription, and
-- consent-aware morning digest foundations. This migration does not enable a
-- WhatsApp provider or schedule an external job.

ALTER TYPE "ActivityEventType" ADD VALUE 'ORDER_REQUEST_REVIEWED';
ALTER TYPE "MessagePurpose" ADD VALUE 'OWNER_DIGEST';

ALTER TABLE "business_preferences"
  ADD COLUMN "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "dailyDigestWhatsapp" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dailyDigestTime" TEXT NOT NULL DEFAULT '08:00',
  ADD COLUMN "dailyDigestWeekdays" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
  ADD COLUMN "dailyDigestPhone" TEXT,
  ADD COLUMN "dailyDigestConsentAt" TIMESTAMP(3),
  ADD COLUMN "dailyDigestConsentVersion" TEXT,
  ADD COLUMN "dailyDigestPausedAt" TIMESTAMP(3),
  ADD COLUMN "lastDailyDigestAt" TIMESTAMP(3),
  ADD COLUMN "pushNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "order_requests" ADD COLUMN "ownerReadAt" TIMESTAMP(3);
ALTER TABLE "messaging_consents" ADD COLUMN "userId" TEXT;
ALTER TABLE "message_outbox" ADD COLUMN "recipientUserId" TEXT;

CREATE TABLE "owner_attention_receipts" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "itemKey" TEXT NOT NULL,
  "seenAt" TIMESTAMP(3),
  "snoozedUntil" TIMESTAMP(3),
  "dismissedAt" TIMESTAMP(3),
  "pushedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "owner_attention_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "owner_push_subscriptions" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "endpointHash" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "userAgent" TEXT,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "owner_push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_attention_receipts_businessId_userId_itemKey_key"
  ON "owner_attention_receipts"("businessId", "userId", "itemKey");
CREATE INDEX "owner_attention_receipts_userId_seenAt_idx"
  ON "owner_attention_receipts"("userId", "seenAt");
CREATE INDEX "owner_attention_receipts_businessId_snoozedUntil_idx"
  ON "owner_attention_receipts"("businessId", "snoozedUntil");
CREATE UNIQUE INDEX "owner_push_subscriptions_endpointHash_key"
  ON "owner_push_subscriptions"("endpointHash");
CREATE INDEX "owner_push_subscriptions_businessId_userId_idx"
  ON "owner_push_subscriptions"("businessId", "userId");
CREATE INDEX "messaging_consents_userId_purpose_idx"
  ON "messaging_consents"("userId", "purpose");
CREATE INDEX "message_outbox_recipientUserId_createdAt_idx"
  ON "message_outbox"("recipientUserId", "createdAt");

ALTER TABLE "owner_attention_receipts"
  ADD CONSTRAINT "owner_attention_receipts_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_attention_receipts"
  ADD CONSTRAINT "owner_attention_receipts_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_push_subscriptions"
  ADD CONSTRAINT "owner_push_subscriptions_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_push_subscriptions"
  ADD CONSTRAINT "owner_push_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messaging_consents"
  ADD CONSTRAINT "messaging_consents_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "message_outbox"
  ADD CONSTRAINT "message_outbox_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
