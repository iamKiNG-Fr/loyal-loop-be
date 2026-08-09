ALTER TABLE "users"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TABLE "onboarding_email_challenges" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_email_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "onboarding_email_challenges_email_createdAt_idx"
ON "onboarding_email_challenges"("email", "createdAt");

CREATE INDEX "onboarding_email_challenges_expiresAt_idx"
ON "onboarding_email_challenges"("expiresAt");
