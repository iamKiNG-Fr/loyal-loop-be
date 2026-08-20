ALTER TYPE "MessagePurpose" ADD VALUE 'CUSTOMER_MEMORY';

ALTER TABLE "business_preferences"
ADD COLUMN "customerMemoryWhatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "customerMemoryPhone" TEXT,
ADD COLUMN "customerMemoryConsentAt" TIMESTAMP(3),
ADD COLUMN "customerMemoryConsentVersion" TEXT;
