CREATE TYPE "FoundingValueFeedbackStatus" AS ENUM ('PENDING', 'DEFERRED', 'SUBMITTED');
CREATE TYPE "FoundingValueRating" AS ENUM ('A_LOT', 'A_LITTLE', 'NOT_YET');
CREATE TYPE "FoundingPaymentInterest" AS ENUM ('YES', 'MAYBE', 'NOT_NOW');
CREATE TYPE "FoundingPaymentBlocker" AS ENUM ('TOO_EARLY', 'NOT_ENOUGH_VALUE', 'PRICE_CONCERN', 'MISSING_FEATURE', 'BUSINESS_NOT_READY', 'OTHER');

CREATE TABLE "founding_value_feedback" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "enrollmentId" TEXT,
    "triggerSaleId" TEXT NOT NULL,
    "triggerSaleSequence" INTEGER NOT NULL,
    "status" "FoundingValueFeedbackStatus" NOT NULL DEFAULT 'PENDING',
    "valueRating" "FoundingValueRating",
    "paymentInterest" "FoundingPaymentInterest",
    "paymentBlocker" "FoundingPaymentBlocker",
    "paymentBlockerDetail" TEXT,
    "valueNeeded" TEXT,
    "volunteeredPriceAmount" DECIMAL(12,2),
    "volunteeredPriceCurrency" TEXT NOT NULL DEFAULT 'NGN',
    "deferralCount" INTEGER NOT NULL DEFAULT 0,
    "promptedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "deferredAt" TIMESTAMP(3),
    "rearmAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "founding_value_feedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "founding_value_feedback_triggerSaleId_key" ON "founding_value_feedback"("triggerSaleId");
CREATE INDEX "founding_value_feedback_businessId_status_createdAt_idx" ON "founding_value_feedback"("businessId", "status", "createdAt");
CREATE INDEX "founding_value_feedback_enrollmentId_createdAt_idx" ON "founding_value_feedback"("enrollmentId", "createdAt");
CREATE INDEX "founding_value_feedback_status_submittedAt_idx" ON "founding_value_feedback"("status", "submittedAt");

ALTER TABLE "founding_value_feedback" ADD CONSTRAINT "founding_value_feedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "founding_value_feedback" ADD CONSTRAINT "founding_value_feedback_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "founding_program_enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "founding_value_feedback" ADD CONSTRAINT "founding_value_feedback_triggerSaleId_fkey" FOREIGN KEY ("triggerSaleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
