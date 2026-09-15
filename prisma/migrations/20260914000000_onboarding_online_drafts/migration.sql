-- Additive invitation-bound drafts. Apply through the normal reviewed release flow.
ALTER TABLE "onboarding_invitations"
  ADD COLUMN "draftCiphertext" TEXT,
  ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "draftSavedAt" TIMESTAMP(3),
  ADD COLUMN "draftExpiresAt" TIMESTAMP(3),
  ADD COLUMN "onboardingStartedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingStep" INTEGER;

CREATE INDEX "onboarding_invitations_draftExpiresAt_idx" ON "onboarding_invitations"("draftExpiresAt");
