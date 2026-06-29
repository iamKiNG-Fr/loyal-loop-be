-- Loyal Loop backend alignment: 20260628190000_identity_media_foundation

-- CreateEnum
CREATE TYPE "BusinessRole" AS ENUM ('OWNER', 'MANAGER', 'SALES', 'DELIVERY', 'VIEWER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BusinessPlan" AS ENUM ('PRIVATE_TESTER', 'STARTER', 'GROWTH', 'TEAM');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INTERNAL_TEST');

-- CreateEnum
CREATE TYPE "BusinessTheme" AS ENUM ('LOYAL_PURPLE', 'MIDNIGHT', 'FRESH', 'BLUSH');

-- CreateEnum
CREATE TYPE "StoreStatus" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "WorkspaceAppearance" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ContactPlatform" AS ENUM ('EMAIL', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'SNAPCHAT', 'TIKTOK', 'WEBSITE', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'SNAPCHAT', 'PHONE', 'WALK_IN', 'REFERRAL', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('ACTIVE', 'DRAFT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductPlacement" AS ENUM ('STANDARD', 'TRENDING', 'RECOMMENDED', 'LATEST_ARRIVAL');

-- CreateEnum
CREATE TYPE "ProductVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentEntryType" AS ENUM ('PAYMENT', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'FACEBOOK', 'TIKTOK', 'SNAPCHAT', 'WALK_IN', 'REFERRAL', 'WEBSITE', 'OTHER');

-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('DELIVERY', 'PICKUP', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('CREATED', 'SENT', 'VIEWED', 'VOID');

-- CreateEnum
CREATE TYPE "ReceiptTheme" AS ENUM ('CLASSIC_POS', 'LOOP_PURPLE', 'MALL_FRESH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PREPARING', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'CONFIRMED', 'ISSUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "ActivityEventType" AS ENUM ('BUSINESS_CREATED', 'BUSINESS_UPDATED', 'OWNER_PLEDGED', 'CUSTOMER_ADDED', 'CUSTOMER_NOTE_ADDED', 'PRODUCT_ADDED', 'PRODUCT_UPDATED', 'SALE_LOGGED', 'PAYMENT_UPDATED', 'RECEIPT_CREATED', 'RECEIPT_SENT', 'RECEIPT_VIEWED', 'RECEIPT_ACKNOWLEDGED', 'DELIVERY_STATUS_UPDATED', 'DELIVERY_CONFIRMED', 'FEEDBACK_SUBMITTED', 'ISSUE_OPENED', 'ISSUE_RESOLVED', 'FOLLOW_UP_SENT', 'INVENTORY_CHECKED', 'STREAK_COMPLETED');

-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('BUSINESS_LOGO', 'PRODUCT_IMAGE', 'TRUST_CARD', 'RECEIPT_EXPORT');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('ACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "OrderRequestStatus" AS ENUM ('SENT', 'ACCEPTED', 'NEEDS_CHANGES', 'CONVERTED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ProductInterestType" AS ENUM ('WISHLIST', 'RESTOCK');

-- CreateEnum
CREATE TYPE "CommerceEventType" AS ENUM ('SHOP_VIEWED', 'PRODUCT_VIEWED', 'PRODUCT_SHARED', 'PRODUCT_WISHLISTED', 'RESTOCK_INTERESTED', 'REQUEST_SUBMITTED');

-- CreateEnum
CREATE TYPE "CustomerIssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('SUGGESTED', 'APPROVED', 'COMPLETED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SupportRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ExportAccess" AS ENUM ('OWNER_ONLY', 'OWNER_AND_MANAGERS');

-- CreateEnum
CREATE TYPE "RetentionPolicy" AS ENUM ('MANUAL', 'ONE_YEAR', 'THREE_YEARS');

-- CreateEnum
CREATE TYPE "NumberFormat" AS ENUM ('COMMA_DECIMAL', 'DOT_DECIMAL');

-- CreateEnum
CREATE TYPE "ReceiptDeliveryLine" AS ENUM ('OPTIONAL', 'ALWAYS_SHOW', 'HIDE_BY_DEFAULT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phone" TEXT,
    "workspaceAppearance" "WorkspaceAppearance" NOT NULL DEFAULT 'LIGHT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_recovery_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_recovery_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "logoAssetId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT,
    "categoryDetail" TEXT,
    "description" TEXT,
    "location" TEXT,
    "storeStatus" "StoreStatus" NOT NULL DEFAULT 'OPEN',
    "pledgeSignature" TEXT,
    "pledgedAt" TIMESTAMP(3),
    "plan" "BusinessPlan" NOT NULL DEFAULT 'PRIVATE_TESTER',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'INTERNAL_TEST',
    "trialStartedAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "customerLimit" INTEGER,
    "receiptLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_preferences" (
    "businessId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "numberFormat" "NumberFormat" NOT NULL DEFAULT 'COMMA_DECIMAL',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "theme" "BusinessTheme" NOT NULL DEFAULT 'LOYAL_PURPLE',
    "shelfMode" TEXT NOT NULL DEFAULT 'carousel',
    "showRecommended" BOOLEAN NOT NULL DEFAULT true,
    "showLatest" BOOLEAN NOT NULL DEFAULT true,
    "defaultPaymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "receiptDeliveryLine" "ReceiptDeliveryLine" NOT NULL DEFAULT 'OPTIONAL',
    "receiptFooter" TEXT,
    "notifyFollowUps" BOOLEAN NOT NULL DEFAULT true,
    "notifyReceiptViews" BOOLEAN NOT NULL DEFAULT false,
    "notifyDeliveryUpdates" BOOLEAN NOT NULL DEFAULT true,
    "exportAccess" "ExportAccess" NOT NULL DEFAULT 'OWNER_ONLY',
    "retentionPolicy" "RetentionPolicy" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_preferences_pkey" PRIMARY KEY ("businessId")
);

-- CreateTable
CREATE TABLE "business_contacts" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "platform" "ContactPlatform" NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_members" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BusinessRole" NOT NULL DEFAULT 'VIEWER',
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "invitedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_invitations" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "BusinessRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'cloudinary',
    "publicId" TEXT NOT NULL,
    "secureUrl" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL DEFAULT 'image',
    "format" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER NOT NULL,
    "version" TEXT,
    "originalFilename" TEXT,
    "purpose" "MediaPurpose" NOT NULL,
    "status" "MediaStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_accounts" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_account_sessions" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_account_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_otp_challenges" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "phone" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "owner_sessions_tokenHash_key" ON "owner_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "owner_sessions_userId_expiresAt_idx" ON "owner_sessions"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_recovery_tokens_tokenHash_key" ON "password_recovery_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_recovery_tokens_userId_expiresAt_idx" ON "password_recovery_tokens"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_logoAssetId_key" ON "businesses"("logoAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");

-- CreateIndex
CREATE INDEX "businesses_ownerId_idx" ON "businesses"("ownerId");

-- CreateIndex
CREATE INDEX "business_contacts_businessId_sortOrder_idx" ON "business_contacts"("businessId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "business_contacts_businessId_platform_value_key" ON "business_contacts"("businessId", "platform", "value");

-- CreateIndex
CREATE INDEX "business_members_userId_idx" ON "business_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_businessId_userId_key" ON "business_members"("businessId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "business_invitations_tokenHash_key" ON "business_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "business_invitations_businessId_email_idx" ON "business_invitations"("businessId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_publicId_key" ON "media_assets"("publicId");

-- CreateIndex
CREATE INDEX "media_assets_businessId_purpose_status_idx" ON "media_assets"("businessId", "purpose", "status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_accounts_phone_key" ON "customer_accounts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customer_account_sessions_tokenHash_key" ON "customer_account_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "customer_account_sessions_customerAccountId_expiresAt_idx" ON "customer_account_sessions"("customerAccountId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_otp_challenges_providerReference_key" ON "customer_otp_challenges"("providerReference");

-- CreateIndex
CREATE INDEX "customer_otp_challenges_phone_createdAt_idx" ON "customer_otp_challenges"("phone", "createdAt");

-- AddForeignKey
ALTER TABLE "owner_sessions" ADD CONSTRAINT "owner_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_recovery_tokens" ADD CONSTRAINT "password_recovery_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_logoAssetId_fkey" FOREIGN KEY ("logoAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_preferences" ADD CONSTRAINT "business_preferences_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_contacts" ADD CONSTRAINT "business_contacts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_invitations" ADD CONSTRAINT "business_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_account_sessions" ADD CONSTRAINT "customer_account_sessions_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_otp_challenges" ADD CONSTRAINT "customer_otp_challenges_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
