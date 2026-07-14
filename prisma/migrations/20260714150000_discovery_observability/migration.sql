CREATE TABLE "discovery_telemetry" (
  "id" TEXT NOT NULL,
  "customerAccountId" TEXT,
  "visitorHash" TEXT,
  "type" VARCHAR(60) NOT NULL,
  "value" DOUBLE PRECISION,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "discovery_telemetry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discovery_telemetry_type_createdAt_idx" ON "discovery_telemetry"("type", "createdAt");
CREATE INDEX "discovery_telemetry_customerAccountId_createdAt_idx" ON "discovery_telemetry"("customerAccountId", "createdAt");
CREATE INDEX "discovery_telemetry_visitorHash_createdAt_idx" ON "discovery_telemetry"("visitorHash", "createdAt");

ALTER TABLE "discovery_telemetry"
  ADD CONSTRAINT "discovery_telemetry_customerAccountId_fkey"
  FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
