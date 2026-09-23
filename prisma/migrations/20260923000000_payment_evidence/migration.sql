-- Additive only. Prepared locally; do not apply outside an authorized release.
ALTER TABLE "payment_entries" ADD COLUMN "evidenceAssetId" TEXT;
CREATE UNIQUE INDEX "payment_entries_evidenceAssetId_key" ON "payment_entries"("evidenceAssetId");
ALTER TABLE "payment_entries" ADD CONSTRAINT "payment_entries_evidenceAssetId_fkey" FOREIGN KEY ("evidenceAssetId") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
