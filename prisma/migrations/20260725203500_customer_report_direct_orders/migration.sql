-- Extend customer reports to cover orders created directly by a business,
-- not only orders converted from a storefront request.
ALTER TYPE "CustomerReportSubjectType" ADD VALUE 'ORDER' BEFORE 'ORDER_REQUEST';

ALTER TABLE "customer_reports" ADD COLUMN "saleId" TEXT;

CREATE INDEX "customer_reports_saleId_idx" ON "customer_reports"("saleId");

ALTER TABLE "customer_reports"
ADD CONSTRAINT "customer_reports_saleId_fkey"
FOREIGN KEY ("saleId") REFERENCES "sales"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
