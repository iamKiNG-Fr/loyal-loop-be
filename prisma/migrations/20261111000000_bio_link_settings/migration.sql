-- Additive only; prepared locally. Apply during an authorized release before this API version.
ALTER TABLE "business_preferences" ADD COLUMN "bioAnnouncement" TEXT;
ALTER TABLE "business_preferences" ADD COLUMN "bioFeaturedProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "business_preferences" ADD COLUMN "bioHiddenSections" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "business_preferences" ADD COLUMN "bioPreviewImage" TEXT NOT NULL DEFAULT 'COVER';
