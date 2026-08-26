ALTER TABLE "business_preferences"
ADD COLUMN "featuredCollectionIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
