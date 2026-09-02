CREATE TYPE "ShowcaseCommerceMode" AS ENUM ('DISCOVERY', 'BUNDLE');
CREATE TYPE "StorefrontStoryKind" AS ENUM ('PRODUCT', 'COLLECTION', 'SHOWCASE', 'EVENT');

ALTER TABLE "business_pickup_locations"
  ADD COLUMN "countryCode" TEXT NOT NULL DEFAULT 'NG',
  ADD COLUMN "regionCode" TEXT;

ALTER TABLE "business_preferences"
  ADD COLUMN "deliveryCountries" TEXT[] NOT NULL DEFAULT ARRAY['NG']::TEXT[],
  ADD COLUMN "collectionOrder" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "showcases"
  ADD COLUMN "commerceMode" "ShowcaseCommerceMode" NOT NULL DEFAULT 'DISCOVERY',
  ADD COLUMN "bundlePrice" DECIMAL(12,2);

ALTER TABLE "customer_cart_groups"
  ADD COLUMN "sourceShowcaseId" TEXT;

CREATE TABLE "storefront_stories" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "kind" "StorefrontStoryKind" NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "productId" TEXT,
  "collectionId" TEXT,
  "showcaseId" TEXT,
  "assetId" TEXT,
  "title" TEXT,
  "caption" TEXT,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "linkUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "storefront_stories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "storefront_stories_businessId_sortOrder_idx" ON "storefront_stories"("businessId", "sortOrder");
CREATE INDEX "storefront_stories_productId_idx" ON "storefront_stories"("productId");
CREATE INDEX "storefront_stories_collectionId_idx" ON "storefront_stories"("collectionId");
CREATE INDEX "storefront_stories_showcaseId_idx" ON "storefront_stories"("showcaseId");

ALTER TABLE "storefront_stories" ADD CONSTRAINT "storefront_stories_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storefront_stories" ADD CONSTRAINT "storefront_stories_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storefront_stories" ADD CONSTRAINT "storefront_stories_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "business_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storefront_stories" ADD CONSTRAINT "storefront_stories_showcaseId_fkey" FOREIGN KEY ("showcaseId") REFERENCES "showcases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "storefront_stories" ADD CONSTRAINT "storefront_stories_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "customer_cart_groups_sourceShowcaseId_idx" ON "customer_cart_groups"("sourceShowcaseId");
ALTER TABLE "customer_cart_groups" ADD CONSTRAINT "customer_cart_groups_sourceShowcaseId_fkey" FOREIGN KEY ("sourceShowcaseId") REFERENCES "showcases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
