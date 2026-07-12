ALTER TYPE "DeliveryStatus" ADD VALUE IF NOT EXISTS 'AWAITING_PAYMENT' BEFORE 'PREPARING';

ALTER TABLE "deliveries"
  ADD COLUMN "courierService" TEXT,
  ADD COLUMN "courierName" TEXT,
  ADD COLUMN "courierPhone" TEXT;

ALTER TABLE "support_requests"
  ADD COLUMN "customerIssueId" TEXT;

CREATE UNIQUE INDEX "support_requests_customerIssueId_key"
  ON "support_requests"("customerIssueId");

ALTER TABLE "support_requests"
  ADD CONSTRAINT "support_requests_customerIssueId_fkey"
  FOREIGN KEY ("customerIssueId") REFERENCES "customer_issues"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
