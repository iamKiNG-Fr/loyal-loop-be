-- Add the customer discovery media types without changing existing assets.
ALTER TYPE "MediaPurpose" ADD VALUE 'SHOP_COVER';
ALTER TYPE "MediaPurpose" ADD VALUE 'SHOWCASE_IMAGE';

CREATE TYPE "ShowcaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

ALTER TABLE "businesses" ADD COLUMN "coverAssetId" TEXT;
ALTER TABLE "order_requests" ADD COLUMN "sourceShowcaseId" TEXT;

CREATE TABLE "showcases" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT,
    "status" "ShowcaseStatus" NOT NULL DEFAULT 'PUBLISHED',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "showcases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "showcase_hotspots" (
    "id" TEXT NOT NULL,
    "showcaseId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "showcase_hotspots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "saved_showcases" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "showcaseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "saved_showcases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shop_follows" (
    "id" TEXT NOT NULL,
    "customerAccountId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shop_follows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "businesses_coverAssetId_key" ON "businesses"("coverAssetId");
CREATE INDEX "showcases_businessId_status_featured_publishedAt_idx" ON "showcases"("businessId", "status", "featured", "publishedAt");
CREATE UNIQUE INDEX "showcase_hotspots_showcaseId_productId_key" ON "showcase_hotspots"("showcaseId", "productId");
CREATE INDEX "showcase_hotspots_productId_idx" ON "showcase_hotspots"("productId");
CREATE UNIQUE INDEX "saved_showcases_customerAccountId_showcaseId_key" ON "saved_showcases"("customerAccountId", "showcaseId");
CREATE INDEX "saved_showcases_businessId_idx" ON "saved_showcases"("businessId");
CREATE UNIQUE INDEX "shop_follows_customerAccountId_businessId_key" ON "shop_follows"("customerAccountId", "businessId");
CREATE INDEX "shop_follows_businessId_idx" ON "shop_follows"("businessId");
CREATE INDEX "order_requests_sourceShowcaseId_idx" ON "order_requests"("sourceShowcaseId");

ALTER TABLE "businesses" ADD CONSTRAINT "businesses_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "showcases" ADD CONSTRAINT "showcases_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "showcases" ADD CONSTRAINT "showcases_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "showcase_hotspots" ADD CONSTRAINT "showcase_hotspots_showcaseId_fkey" FOREIGN KEY ("showcaseId") REFERENCES "showcases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "showcase_hotspots" ADD CONSTRAINT "showcase_hotspots_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_showcases" ADD CONSTRAINT "saved_showcases_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_showcases" ADD CONSTRAINT "saved_showcases_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "saved_showcases" ADD CONSTRAINT "saved_showcases_showcaseId_fkey" FOREIGN KEY ("showcaseId") REFERENCES "showcases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_customerAccountId_fkey" FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shop_follows" ADD CONSTRAINT "shop_follows_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_sourceShowcaseId_fkey" FOREIGN KEY ("sourceShowcaseId") REFERENCES "showcases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
