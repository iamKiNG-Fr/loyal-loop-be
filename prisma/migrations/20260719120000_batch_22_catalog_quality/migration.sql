-- Batch 22: catalog quality, media safety, platform review, and customer order notices.

CREATE TYPE "PlatformRole" AS ENUM ('SUPERADMIN', 'ADMIN', 'FINANCE_ADMIN');
CREATE TYPE "PlatformAdminStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "MediaQualityStatus" AS ENUM ('PENDING', 'PASS', 'WARN', 'FAIL');
CREATE TYPE "MediaModerationStatus" AS ENUM ('PENDING', 'AUTO_APPROVED', 'REVIEW_REQUIRED', 'REJECTED', 'MANUALLY_APPROVED');
CREATE TYPE "MediaContentRating" AS ENUM ('GENERAL', 'SENSITIVE_18', 'PROHIBITED');
CREATE TYPE "MediaReviewDecision" AS ENUM ('APPROVE_GENERAL', 'APPROVE_SENSITIVE', 'REJECT');
CREATE TYPE "CustomerOrderNoticeType" AS ENUM ('REQUEST_ACCEPTED', 'REQUEST_NEEDS_CHANGES', 'REQUEST_CANCELED', 'ORDER_CONFIRMED', 'PAYMENT_UPDATED', 'DELIVERY_UPDATED', 'ISSUE_UPDATED');

CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "status" "PlatformAdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastReviewedAt" TIMESTAMP(3),
    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admins_userId_key" ON "platform_admins"("userId");
CREATE INDEX "platform_admins_role_status_idx" ON "platform_admins"("role", "status");
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "media_assets"
  ADD COLUMN "qualityStatus" "MediaQualityStatus" NOT NULL DEFAULT 'PASS',
  ADD COLUMN "moderationStatus" "MediaModerationStatus" NOT NULL DEFAULT 'AUTO_APPROVED',
  ADD COLUMN "contentRating" "MediaContentRating" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "qualityMetrics" JSONB,
  ADD COLUMN "moderationLabels" JSONB,
  ADD COLUMN "moderationProvider" TEXT,
  ADD COLUMN "moderationModelVersion" TEXT,
  ADD COLUMN "exactHash" TEXT,
  ADD COLUMN "perceptualHash" TEXT,
  ADD COLUMN "assessedAt" TIMESTAMP(3),
  ADD COLUMN "appealedAt" TIMESTAMP(3),
  ADD COLUMN "appealReason" TEXT;

CREATE INDEX "media_assets_moderationStatus_contentRating_qualityStatus_idx" ON "media_assets"("moderationStatus", "contentRating", "qualityStatus");
CREATE INDEX "media_assets_businessId_exactHash_idx" ON "media_assets"("businessId", "exactHash");
CREATE INDEX "media_assets_businessId_perceptualHash_idx" ON "media_assets"("businessId", "perceptualHash");

ALTER TABLE "products" ADD COLUMN "contentRating" "MediaContentRating" NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "showcases" ADD COLUMN "contentRating" "MediaContentRating" NOT NULL DEFAULT 'GENERAL';

CREATE TABLE "media_moderation_reviews" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "MediaReviewDecision" NOT NULL,
    "previousStatus" "MediaModerationStatus" NOT NULL,
    "nextStatus" "MediaModerationStatus" NOT NULL,
    "previousRating" "MediaContentRating" NOT NULL,
    "nextRating" "MediaContentRating" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_moderation_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "media_moderation_reviews_assetId_createdAt_idx" ON "media_moderation_reviews"("assetId", "createdAt");
CREATE INDEX "media_moderation_reviews_reviewerId_createdAt_idx" ON "media_moderation_reviews"("reviewerId", "createdAt");
ALTER TABLE "media_moderation_reviews" ADD CONSTRAINT "media_moderation_reviews_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_moderation_reviews" ADD CONSTRAINT "media_moderation_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "customer_order_notices" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "orderRequestId" TEXT NOT NULL,
    "type" "CustomerOrderNoticeType" NOT NULL,
    "message" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "actionResolvedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_order_notices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_order_notices_dedupeKey_key" ON "customer_order_notices"("dedupeKey");
CREATE INDEX "customer_order_notices_customerAccountId_readAt_createdAt_idx" ON "customer_order_notices"("customerAccountId", "readAt", "createdAt");
CREATE INDEX "customer_order_notices_orderRequestId_createdAt_idx" ON "customer_order_notices"("orderRequestId", "createdAt");
ALTER TABLE "customer_order_notices" ADD CONSTRAINT "customer_order_notices_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_order_notices" ADD CONSTRAINT "customer_order_notices_orderRequestId_fkey" FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
