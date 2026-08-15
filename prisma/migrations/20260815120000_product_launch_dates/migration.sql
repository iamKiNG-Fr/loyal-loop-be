ALTER TABLE "products" ADD COLUMN "launchAt" TIMESTAMP(3);

CREATE INDEX "products_businessId_launchAt_idx" ON "products"("businessId", "launchAt");
