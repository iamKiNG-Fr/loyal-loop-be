-- Additive only; prepared locally. Apply during an authorized release before this API version.
-- Existing rows become SUPPORT, which is what they all are today.
CREATE TYPE "SupportRequestKind" AS ENUM ('SUPPORT', 'FEEDBACK');
ALTER TABLE "support_requests" ADD COLUMN "kind" "SupportRequestKind" NOT NULL DEFAULT 'SUPPORT';
CREATE INDEX "support_requests_kind_status_createdAt_idx" ON "support_requests"("kind", "status", "createdAt");
