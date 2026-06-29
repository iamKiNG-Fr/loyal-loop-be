-- Loyal Loop backend alignment: 20260628190200_public_engagement

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_interests" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ProductInterestType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_interests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_requests" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "customerId" TEXT,
    "referenceCode" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "channel" "SalesChannel" NOT NULL,
    "note" TEXT,
    "status" "OrderRequestStatus" NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_request_items" (
    "id" TEXT NOT NULL,
    "orderRequestId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "order_request_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce_events" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerAccountId" TEXT,
    "productId" TEXT,
    "orderRequestId" TEXT,
    "type" "CommerceEventType" NOT NULL,
    "visitorHash" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_feedback" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "saleId" TEXT NOT NULL,
    "receiptId" TEXT,
    "deliveryId" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_issues" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT,
    "saleId" TEXT NOT NULL,
    "receiptId" TEXT,
    "deliveryId" TEXT,
    "description" TEXT NOT NULL,
    "status" "CustomerIssueStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_requests" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "SupportRequestStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wishlist_items_businessId_idx" ON "wishlist_items"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_customerAccountId_productId_key" ON "wishlist_items"("customerAccountId", "productId");

-- CreateIndex
CREATE INDEX "product_interests_businessId_type_idx" ON "product_interests"("businessId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "product_interests_customerAccountId_productId_type_key" ON "product_interests"("customerAccountId", "productId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "order_requests_referenceCode_key" ON "order_requests"("referenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "order_requests_tokenHash_key" ON "order_requests"("tokenHash");

-- CreateIndex
CREATE INDEX "order_requests_businessId_status_createdAt_idx" ON "order_requests"("businessId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "order_request_items_orderRequestId_idx" ON "order_request_items"("orderRequestId");

-- CreateIndex
CREATE INDEX "commerce_events_businessId_type_createdAt_idx" ON "commerce_events"("businessId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "commerce_events_productId_type_idx" ON "commerce_events"("productId", "type");

-- CreateIndex
CREATE INDEX "customer_feedback_businessId_createdAt_idx" ON "customer_feedback"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_feedback_deliveryId_key" ON "customer_feedback"("deliveryId");

-- CreateIndex
CREATE INDEX "customer_issues_businessId_status_openedAt_idx" ON "customer_issues"("businessId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "support_requests_businessId_status_createdAt_idx" ON "support_requests"("businessId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_interests" ADD CONSTRAINT "product_interests_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_interests" ADD CONSTRAINT "product_interests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_interests" ADD CONSTRAINT "product_interests_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_orderRequestId_fkey" FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_request_items" ADD CONSTRAINT "order_request_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_events" ADD CONSTRAINT "commerce_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_events" ADD CONSTRAINT "commerce_events_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_events" ADD CONSTRAINT "commerce_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_events" ADD CONSTRAINT "commerce_events_orderRequestId_fkey" FOREIGN KEY ("orderRequestId") REFERENCES "order_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_sourceRequestId_fkey" FOREIGN KEY ("sourceRequestId") REFERENCES "order_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_issues" ADD CONSTRAINT "customer_issues_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_issues" ADD CONSTRAINT "customer_issues_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_issues" ADD CONSTRAINT "customer_issues_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_issues" ADD CONSTRAINT "customer_issues_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_issues" ADD CONSTRAINT "customer_issues_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_requests" ADD CONSTRAINT "support_requests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
