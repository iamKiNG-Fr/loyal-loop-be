-- CreateEnum
CREATE TYPE "BusinessCapability" AS ENUM ('CUSTOMER_READ', 'CUSTOMER_WRITE', 'CATALOG_READ', 'CATALOG_WRITE', 'SALE_READ', 'SALE_WRITE', 'PAYMENT_REVIEW', 'ORDER_READ', 'ORDER_WRITE', 'DELIVERY_READ', 'DELIVERY_WRITE', 'ISSUE_READ', 'ISSUE_WRITE', 'INSIGHT_READ', 'PROFILE_WRITE', 'SETTINGS_WRITE', 'EXPORT_DATA', 'PERMISSION_ADMIN');

-- CreateEnum
CREATE TYPE "ProductMediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'SUBMITTED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "InsightSummaryStatus" AS ENUM ('READY', 'STALE', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "MessagePurpose" AS ENUM ('OTP', 'RECEIPT', 'DELIVERY');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED', 'DEAD_LETTER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityEventType" ADD VALUE 'MEMBER_PERMISSIONS_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'REQUEST_PAYMENT_UPDATED';
ALTER TYPE "ActivityEventType" ADD VALUE 'MESSAGE_ENQUEUED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommerceEventType" ADD VALUE 'SHOP_FOLLOWED';
ALTER TYPE "CommerceEventType" ADD VALUE 'PRODUCT_SAVED';
ALTER TYPE "CommerceEventType" ADD VALUE 'SHOWCASE_VIEWED';
ALTER TYPE "CommerceEventType" ADD VALUE 'SHOWCASE_SHARED';
ALTER TYPE "CommerceEventType" ADD VALUE 'SHOWCASE_SAVED';
ALTER TYPE "CommerceEventType" ADD VALUE 'PURCHASE_COMPLETED';
ALTER TYPE "CommerceEventType" ADD VALUE 'PREFERENCE_UPDATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MediaPurpose" ADD VALUE 'PRODUCT_VIDEO';
ALTER TYPE "MediaPurpose" ADD VALUE 'PRODUCT_POSTER';
ALTER TYPE "MediaPurpose" ADD VALUE 'SHOWCASE_VIDEO';
ALTER TYPE "MediaPurpose" ADD VALUE 'SHOWCASE_POSTER';

-- AlterTable
ALTER TABLE "business_preferences" ADD COLUMN     "allowedPaymentMethods" "PaymentMethod"[] DEFAULT ARRAY['BANK_TRANSFER', 'PAY_ON_DELIVERY', 'CASH', 'ARRANGE_SEPARATELY']::"PaymentMethod"[],
ADD COLUMN     "defaultPaymentMethod" "PaymentMethod";

-- AlterTable
ALTER TABLE "commerce_events" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "sessionKey" TEXT,
ADD COLUMN     "showcaseId" TEXT;

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "durationSeconds" DOUBLE PRECISION,
ADD COLUMN     "mimeType" TEXT;

-- AlterTable
ALTER TABLE "order_request_items" ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "variantName" TEXT,
ADD COLUMN     "variantSnapshot" JSONB;

-- AlterTable
ALTER TABLE "order_requests" ADD COLUMN     "clientIdempotencyKey" TEXT,
ADD COLUMN     "requestedPaymentMethod" "PaymentMethod";

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "attributes" JSONB,
ADD COLUMN     "categoryId" TEXT;

-- AlterTable
ALTER TABLE "showcases" ADD COLUMN     "durationSeconds" DOUBLE PRECISION,
ADD COLUMN     "mediaKind" "ProductMediaKind" NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "posterAssetId" TEXT;

-- CreateTable
CREATE TABLE "member_permission_overrides" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "capability" "BusinessCapability" NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_permission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_insight_summaries" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "InsightSummaryStatus" NOT NULL DEFAULT 'READY',
    "summary" JSONB NOT NULL,
    "evidenceVersion" TEXT NOT NULL,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "staleAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_insight_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_categories" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "templateKey" TEXT,
    "attributes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "optionValues" JSONB NOT NULL,
    "priceOverride" DECIMAL(12,2),
    "sku" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stockCount" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "posterAssetId" TEXT,
    "kind" "ProductMediaKind" NOT NULL DEFAULT 'IMAGE',
    "altText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "durationSeconds" DOUBLE PRECISION,
    "quality" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_carts" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "deviceKey" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "variantKey" TEXT NOT NULL DEFAULT 'default',
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "priceSnapshot" DECIMAL(12,2) NOT NULL,
    "stockSnapshot" INTEGER,
    "availabilityChanged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_cart_groups" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerAddressId" TEXT,
    "fulfillment" "FulfillmentType" NOT NULL DEFAULT 'ARRANGE_LATER',
    "note" TEXT,
    "paymentPreference" "PaymentMethod",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_cart_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_request_payment_changes" (
    "id" TEXT NOT NULL,
    "orderRequestId" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "previousMethod" "PaymentMethod",
    "nextMethod" "PaymentMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_request_payment_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_preferences" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "customerAccountId" TEXT,
    "visitorHash" TEXT,
    "preferences" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_consents" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "phoneHash" TEXT NOT NULL,
    "purpose" "MessagePurpose" NOT NULL,
    "source" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messaging_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_suppressions" (
    "id" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'WHATSAPP',
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messaging_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_outbox" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "customerAccountId" TEXT,
    "channel" "MessageChannel" NOT NULL DEFAULT 'WHATSAPP',
    "purpose" "MessagePurpose" NOT NULL,
    "toAddress" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerReference" TEXT,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attempts" (
    "id" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "status" "MessageStatus" NOT NULL,
    "error" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messaging_webhook_events" (
    "id" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messaging_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_permission_overrides_capability_idx" ON "member_permission_overrides"("capability");

-- CreateIndex
CREATE UNIQUE INDEX "member_permission_overrides_memberId_capability_key" ON "member_permission_overrides"("memberId", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "customer_insight_summaries_customerId_key" ON "customer_insight_summaries"("customerId");

-- CreateIndex
CREATE INDEX "customer_insight_summaries_businessId_status_updatedAt_idx" ON "customer_insight_summaries"("businessId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "business_categories_businessId_createdAt_idx" ON "business_categories"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_categories_businessId_slug_key" ON "business_categories"("businessId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "business_categories_businessId_name_key" ON "business_categories"("businessId", "name");

-- CreateIndex
CREATE INDEX "product_variants_productId_active_sortOrder_idx" ON "product_variants"("productId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_productId_sku_key" ON "product_variants"("productId", "sku");

-- CreateIndex
CREATE INDEX "product_media_productId_sortOrder_idx" ON "product_media"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "product_media_productId_assetId_key" ON "product_media"("productId", "assetId");

-- CreateIndex
CREATE INDEX "customer_carts_updatedAt_idx" ON "customer_carts"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_carts_customerAccountId_status_key" ON "customer_carts"("customerAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_carts_deviceKey_status_key" ON "customer_carts"("deviceKey", "status");

-- CreateIndex
CREATE INDEX "customer_cart_items_cartId_businessId_idx" ON "customer_cart_items"("cartId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_cart_items_cartId_productId_variantKey_key" ON "customer_cart_items"("cartId", "productId", "variantKey");

-- CreateIndex
CREATE INDEX "customer_cart_groups_businessId_idx" ON "customer_cart_groups"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_cart_groups_cartId_businessId_key" ON "customer_cart_groups"("cartId", "businessId");

-- CreateIndex
CREATE INDEX "order_request_payment_changes_orderRequestId_createdAt_idx" ON "order_request_payment_changes"("orderRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "discovery_preferences_updatedAt_idx" ON "discovery_preferences"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_preferences_customerAccountId_businessId_key" ON "discovery_preferences"("customerAccountId", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_preferences_visitorHash_businessId_key" ON "discovery_preferences"("visitorHash", "businessId");

-- CreateIndex
CREATE INDEX "messaging_consents_customerAccountId_purpose_idx" ON "messaging_consents"("customerAccountId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_consents_phoneHash_purpose_key" ON "messaging_consents"("phoneHash", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_suppressions_phoneHash_key" ON "messaging_suppressions"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "message_outbox_idempotencyKey_key" ON "message_outbox"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "message_outbox_providerReference_key" ON "message_outbox"("providerReference");

-- CreateIndex
CREATE INDEX "message_outbox_status_nextAttemptAt_idx" ON "message_outbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "message_outbox_businessId_createdAt_idx" ON "message_outbox"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "message_attempts_outboxId_createdAt_idx" ON "message_attempts"("outboxId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "messaging_webhook_events_providerEventId_key" ON "messaging_webhook_events"("providerEventId");

-- CreateIndex
CREATE INDEX "messaging_webhook_events_processedAt_createdAt_idx" ON "messaging_webhook_events"("processedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "commerce_events_dedupeKey_key" ON "commerce_events"("dedupeKey");

-- CreateIndex
CREATE INDEX "commerce_events_showcaseId_type_idx" ON "commerce_events"("showcaseId", "type");

-- CreateIndex
CREATE INDEX "commerce_events_customerAccountId_type_createdAt_idx" ON "commerce_events"("customerAccountId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "order_request_items_variantId_idx" ON "order_request_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "order_requests_customerAccountId_clientIdempotencyKey_key" ON "order_requests"("customerAccountId", "clientIdempotencyKey");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- AddForeignKey
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "business_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_permission_overrides" ADD CONSTRAINT "member_permission_overrides_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_insight_summaries" ADD CONSTRAINT "customer_insight_summaries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_insight_summaries" ADD CONSTRAINT "customer_insight_summaries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_categories" ADD CONSTRAINT "business_categories_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "business_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_posterAssetId_fkey" FOREIGN KEY ("posterAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "showcases" ADD CONSTRAINT "showcases_posterAssetId_fkey" FOREIGN KEY ("posterAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_carts" ADD CONSTRAINT "customer_carts_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cart_items" ADD CONSTRAINT "customer_cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "customer_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cart_items" ADD CONSTRAINT "customer_cart_items_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cart_items" ADD CONSTRAINT "customer_cart_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cart_items" ADD CONSTRAINT "customer_cart_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cart_groups" ADD CONSTRAINT "customer_cart_groups_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "customer_carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cart_groups" ADD CONSTRAINT "customer_cart_groups_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_cart_groups" ADD CONSTRAINT "customer_cart_groups_customerAddressId_fkey" FOREIGN KEY ("customerAddressId") REFERENCES "customer_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_payment_changes" ADD CONSTRAINT "order_request_payment_changes_orderRequestId_fkey" FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_events" ADD CONSTRAINT "commerce_events_showcaseId_fkey" FOREIGN KEY ("showcaseId") REFERENCES "showcases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_preferences" ADD CONSTRAINT "discovery_preferences_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_preferences" ADD CONSTRAINT "discovery_preferences_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messaging_consents" ADD CONSTRAINT "messaging_consents_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_outbox" ADD CONSTRAINT "message_outbox_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attempts" ADD CONSTRAINT "message_attempts_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "message_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
