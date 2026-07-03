CREATE TYPE "PaymentMethod" AS ENUM (
  'BANK_TRANSFER',
  'PAY_ON_DELIVERY',
  'CASH',
  'ARRANGE_SEPARATELY'
);

CREATE TYPE "PaymentProofStatus" AS ENUM (
  'SUBMITTED',
  'VERIFIED',
  'REJECTED'
);

ALTER TYPE "MediaPurpose" ADD VALUE 'PAYMENT_PROOF';

ALTER TABLE "media_assets"
  ALTER COLUMN "uploadedById" DROP NOT NULL;

ALTER TABLE "media_assets"
  DROP CONSTRAINT "media_assets_uploadedById_fkey";

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_uploadedById_fkey"
  FOREIGN KEY ("uploadedById")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE "business_payment_accounts" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "bankName" TEXT NOT NULL,
  "bankCode" TEXT,
  "accountName" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "instructions" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "business_payment_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_payment_accounts_businessId_key"
  ON "business_payment_accounts"("businessId");

ALTER TABLE "business_payment_accounts"
  ADD CONSTRAINT "business_payment_accounts_businessId_fkey"
  FOREIGN KEY ("businessId")
  REFERENCES "businesses"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE TABLE "sale_payment_instructions" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "method" "PaymentMethod" NOT NULL,
  "bankName" TEXT,
  "bankCode" TEXT,
  "accountName" TEXT,
  "accountNumber" TEXT,
  "instructions" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sale_payment_instructions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sale_payment_instructions_saleId_key"
  ON "sale_payment_instructions"("saleId");

ALTER TABLE "sale_payment_instructions"
  ADD CONSTRAINT "sale_payment_instructions_saleId_fkey"
  FOREIGN KEY ("saleId")
  REFERENCES "sales"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

CREATE TABLE "payment_proofs" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL,
  "reviewedById" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "reference" TEXT,
  "status" "PaymentProofStatus" NOT NULL DEFAULT 'SUBMITTED',
  "reviewNote" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_proofs_assetId_key"
  ON "payment_proofs"("assetId");

CREATE INDEX "payment_proofs_businessId_status_submittedAt_idx"
  ON "payment_proofs"("businessId", "status", "submittedAt");

CREATE INDEX "payment_proofs_saleId_submittedAt_idx"
  ON "payment_proofs"("saleId", "submittedAt");

ALTER TABLE "payment_proofs"
  ADD CONSTRAINT "payment_proofs_businessId_fkey"
  FOREIGN KEY ("businessId")
  REFERENCES "businesses"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "payment_proofs"
  ADD CONSTRAINT "payment_proofs_saleId_fkey"
  FOREIGN KEY ("saleId")
  REFERENCES "sales"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "payment_proofs"
  ADD CONSTRAINT "payment_proofs_assetId_fkey"
  FOREIGN KEY ("assetId")
  REFERENCES "media_assets"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "payment_proofs"
  ADD CONSTRAINT "payment_proofs_reviewedById_fkey"
  FOREIGN KEY ("reviewedById")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

ALTER TABLE "payment_entries"
  ADD COLUMN "paymentProofId" TEXT;

CREATE UNIQUE INDEX "payment_entries_paymentProofId_key"
  ON "payment_entries"("paymentProofId");

ALTER TABLE "payment_entries"
  ADD CONSTRAINT "payment_entries_paymentProofId_fkey"
  FOREIGN KEY ("paymentProofId")
  REFERENCES "payment_proofs"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE TABLE "delivery_share_tokens" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),

  CONSTRAINT "delivery_share_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_share_tokens_tokenHash_key"
  ON "delivery_share_tokens"("tokenHash");

CREATE INDEX "delivery_share_tokens_deliveryId_createdAt_idx"
  ON "delivery_share_tokens"("deliveryId", "createdAt");

ALTER TABLE "delivery_share_tokens"
  ADD CONSTRAINT "delivery_share_tokens_deliveryId_fkey"
  FOREIGN KEY ("deliveryId")
  REFERENCES "deliveries"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
