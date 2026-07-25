-- CreateEnum
CREATE TYPE "CustomerReportSubjectType" AS ENUM ('ORDER_REQUEST', 'PRODUCT', 'SHOWCASE', 'SHOP');

-- CreateEnum
CREATE TYPE "CustomerReportReason" AS ENUM ('FRAUD_OR_SCAM', 'HARASSMENT_OR_HATE', 'MISLEADING_OR_INCORRECT', 'ORDER_PROBLEM', 'PRIVACY_OR_SAFETY', 'PROHIBITED_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "customer_reports" (
    "id" TEXT NOT NULL,
    "reporterCustomerAccountId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subjectType" "CustomerReportSubjectType" NOT NULL,
    "reason" "CustomerReportReason" NOT NULL,
    "status" "CustomerReportStatus" NOT NULL DEFAULT 'OPEN',
    "subjectLabelSnapshot" TEXT NOT NULL,
    "details" TEXT,
    "orderRequestId" TEXT,
    "productId" TEXT,
    "showcaseId" TEXT,
    "reviewedByAdminId" TEXT,
    "reviewNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_reports_status_createdAt_idx" ON "customer_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "customer_reports_businessId_status_createdAt_idx" ON "customer_reports"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "customer_reports_reporterCustomerAccountId_subjectType_createdAt_idx" ON "customer_reports"("reporterCustomerAccountId", "subjectType", "createdAt");

-- CreateIndex
CREATE INDEX "customer_reports_orderRequestId_idx" ON "customer_reports"("orderRequestId");

-- CreateIndex
CREATE INDEX "customer_reports_productId_idx" ON "customer_reports"("productId");

-- CreateIndex
CREATE INDEX "customer_reports_showcaseId_idx" ON "customer_reports"("showcaseId");

-- AddForeignKey
ALTER TABLE "customer_reports" ADD CONSTRAINT "customer_reports_reporterCustomerAccountId_fkey" FOREIGN KEY ("reporterCustomerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reports" ADD CONSTRAINT "customer_reports_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reports" ADD CONSTRAINT "customer_reports_orderRequestId_fkey" FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reports" ADD CONSTRAINT "customer_reports_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reports" ADD CONSTRAINT "customer_reports_showcaseId_fkey" FOREIGN KEY ("showcaseId") REFERENCES "showcases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_reports" ADD CONSTRAINT "customer_reports_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
