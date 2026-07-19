-- Batch 23: Founding Circle access, platform-admin sessions, research, and safety suspension.
-- Additive only. This migration intentionally preserves the legacy waitlist and PRIVATE_TESTER plan value.

CREATE TYPE "BusinessPlatformStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "OwnerOtpPurpose" AS ENUM ('LOGIN', 'ONBOARDING', 'PLATFORM_ADMIN_STEP_UP');
CREATE TYPE "FoundingApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'INVITED');
CREATE TYPE "FoundingApplicationSource" AS ENUM ('HOMEPAGE', 'DIRECT_ADMIN', 'LEGACY_WAITLIST');
CREATE TYPE "FoundingCohortStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "OnboardingInvitationStatus" AS ENUM ('ISSUED', 'REDEEMED', 'REVOKED', 'EXPIRED');
CREATE TYPE "FoundingEnrollmentStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'PAUSED', 'EXITED');
CREATE TYPE "PaidPilotInterest" AS ENUM ('NOT_ASKED', 'YES', 'MAYBE', 'NO');

ALTER TYPE "MessagePurpose" ADD VALUE IF NOT EXISTS 'FOUNDING_ACCESS';

ALTER TABLE "owner_otp_challenges"
  ADD COLUMN "purpose" "OwnerOtpPurpose" NOT NULL DEFAULT 'LOGIN';

ALTER TABLE "businesses"
  ADD COLUMN "platformStatus" "BusinessPlatformStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "platformSuspendedAt" TIMESTAMP(3),
  ADD COLUMN "platformSuspensionReason" TEXT,
  ADD COLUMN "platformSuspendedByAdminId" TEXT,
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "businesses_platformStatus_isDemo_createdAt_idx"
  ON "businesses"("platformStatus", "isDemo", "createdAt");
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_platformSuspendedByAdminId_fkey"
  FOREIGN KEY ("platformSuspendedByAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "platform_admin_sessions" (
  "id" TEXT NOT NULL,
  "platformAdminId" TEXT NOT NULL,
  "ownerSessionId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_admin_sessions_tokenHash_key" ON "platform_admin_sessions"("tokenHash");
CREATE INDEX "platform_admin_sessions_platformAdminId_expiresAt_idx" ON "platform_admin_sessions"("platformAdminId", "expiresAt");
CREATE INDEX "platform_admin_sessions_ownerSessionId_revokedAt_idx" ON "platform_admin_sessions"("ownerSessionId", "revokedAt");
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_platformAdminId_fkey" FOREIGN KEY ("platformAdminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_ownerSessionId_fkey" FOREIGN KEY ("ownerSessionId") REFERENCES "owner_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "platform_admin_audit_logs" (
  "id" TEXT NOT NULL,
  "actorAdminId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "reason" TEXT,
  "before" JSONB,
  "after" JSONB,
  "requestId" TEXT,
  "ipHash" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_admin_audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "platform_admin_audit_logs_actorAdminId_createdAt_idx" ON "platform_admin_audit_logs"("actorAdminId", "createdAt");
CREATE INDEX "platform_admin_audit_logs_targetType_targetId_createdAt_idx" ON "platform_admin_audit_logs"("targetType", "targetId", "createdAt");
ALTER TABLE "platform_admin_audit_logs" ADD CONSTRAINT "platform_admin_audit_logs_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "founding_access_applications" (
  "id" TEXT NOT NULL,
  "ownerName" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT,
  "whatTheySell" TEXT,
  "primarySellingChannel" TEXT,
  "whatsappConsentAt" TIMESTAMP(3),
  "whatsappConsentSource" TEXT,
  "source" "FoundingApplicationSource" NOT NULL DEFAULT 'HOMEPAGE',
  "status" "FoundingApplicationStatus" NOT NULL DEFAULT 'PENDING',
  "reviewNotes" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "founding_access_applications_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "founding_access_applications_email_key" ON "founding_access_applications"("email");
CREATE UNIQUE INDEX "founding_access_applications_phone_key" ON "founding_access_applications"("phone");
CREATE INDEX "founding_access_applications_status_createdAt_idx" ON "founding_access_applications"("status", "createdAt");
ALTER TABLE "founding_access_applications" ADD CONSTRAINT "founding_access_applications_reviewedByAdminId_fkey" FOREIGN KEY ("reviewedByAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "founding_access_applications" (
  "id", "ownerName", "businessName", "email", "source", "status", "createdAt", "updatedAt"
)
SELECT
  'legacy-waitlist-' || "id"::text, "name", "businessName", lower("email"),
  'LEGACY_WAITLIST'::"FoundingApplicationSource", 'PENDING'::"FoundingApplicationStatus",
  "createdAt", "updatedAt"
FROM "waitlist"
ON CONFLICT ("email") DO NOTHING;

CREATE TABLE "founding_cohorts" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "hypothesis" TEXT,
  "status" "FoundingCohortStatus" NOT NULL DEFAULT 'ACTIVE',
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdByAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "founding_cohorts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "founding_cohorts_key_key" ON "founding_cohorts"("key");
CREATE INDEX "founding_cohorts_status_createdAt_idx" ON "founding_cohorts"("status", "createdAt");
ALTER TABLE "founding_cohorts" ADD CONSTRAINT "founding_cohorts_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "onboarding_invitations" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT,
  "cohortId" TEXT,
  "codeHash" TEXT NOT NULL,
  "codeSuffix" TEXT NOT NULL,
  "encryptedToken" TEXT,
  "recipientName" TEXT NOT NULL,
  "businessName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "email" TEXT,
  "status" "OnboardingInvitationStatus" NOT NULL DEFAULT 'ISSUED',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "maxUses" INTEGER NOT NULL DEFAULT 1,
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "validatedAt" TIMESTAMP(3),
  "redeemedAt" TIMESTAMP(3),
  "redeemedByUserId" TEXT,
  "resultingBusinessId" TEXT,
  "messageOutboxId" TEXT,
  "createdByAdminId" TEXT NOT NULL,
  "revokedByAdminId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "onboarding_invitations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "onboarding_invitations_applicationId_key" ON "onboarding_invitations"("applicationId");
CREATE UNIQUE INDEX "onboarding_invitations_codeHash_key" ON "onboarding_invitations"("codeHash");
CREATE UNIQUE INDEX "onboarding_invitations_resultingBusinessId_key" ON "onboarding_invitations"("resultingBusinessId");
CREATE UNIQUE INDEX "onboarding_invitations_messageOutboxId_key" ON "onboarding_invitations"("messageOutboxId");
CREATE INDEX "onboarding_invitations_status_expiresAt_idx" ON "onboarding_invitations"("status", "expiresAt");
CREATE INDEX "onboarding_invitations_phone_status_idx" ON "onboarding_invitations"("phone", "status");
CREATE INDEX "onboarding_invitations_cohortId_createdAt_idx" ON "onboarding_invitations"("cohortId", "createdAt");
ALTER TABLE "onboarding_invitations" ADD CONSTRAINT "onboarding_invitations_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "founding_access_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_invitations" ADD CONSTRAINT "onboarding_invitations_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "founding_cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_invitations" ADD CONSTRAINT "onboarding_invitations_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "onboarding_invitations" ADD CONSTRAINT "onboarding_invitations_revokedByAdminId_fkey" FOREIGN KEY ("revokedByAdminId") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "onboarding_invitations" ADD CONSTRAINT "onboarding_invitations_messageOutboxId_fkey" FOREIGN KEY ("messageOutboxId") REFERENCES "message_outbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "founding_program_enrollments" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "cohortId" TEXT,
  "status" "FoundingEnrollmentStatus" NOT NULL DEFAULT 'ONBOARDING',
  "invitedAt" TIMESTAMP(3) NOT NULL,
  "onboardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "weekOneRetainedAt" TIMESTAMP(3),
  "weekFourRetainedAt" TIMESTAMP(3),
  "complimentaryNoticeAt" TIMESTAMP(3),
  "complimentaryEndsAt" TIMESTAMP(3),
  "exitedAt" TIMESTAMP(3),
  "exitReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "founding_program_enrollments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "founding_program_enrollments_businessId_key" ON "founding_program_enrollments"("businessId");
CREATE UNIQUE INDEX "founding_program_enrollments_invitationId_key" ON "founding_program_enrollments"("invitationId");
CREATE INDEX "founding_program_enrollments_status_activatedAt_idx" ON "founding_program_enrollments"("status", "activatedAt");
CREATE INDEX "founding_program_enrollments_cohortId_createdAt_idx" ON "founding_program_enrollments"("cohortId", "createdAt");
ALTER TABLE "founding_program_enrollments" ADD CONSTRAINT "founding_program_enrollments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "founding_program_enrollments" ADD CONSTRAINT "founding_program_enrollments_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "onboarding_invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "founding_program_enrollments" ADD CONSTRAINT "founding_program_enrollments_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "founding_cohorts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "founding_research_interviews" (
  "id" TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "interviewerAdminId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stage" TEXT NOT NULL,
  "mostValuableOutcome" TEXT,
  "primaryBlocker" TEXT,
  "paidPilotInterest" "PaidPilotInterest" NOT NULL DEFAULT 'NOT_ASKED',
  "reasonToPayOrNot" TEXT,
  "volunteeredPriceAmount" DECIMAL(12,2),
  "volunteeredPriceCurrency" TEXT NOT NULL DEFAULT 'NGN',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "founding_research_interviews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "founding_research_interviews_enrollmentId_occurredAt_idx" ON "founding_research_interviews"("enrollmentId", "occurredAt");
CREATE INDEX "founding_research_interviews_interviewerAdminId_occurredAt_idx" ON "founding_research_interviews"("interviewerAdminId", "occurredAt");
ALTER TABLE "founding_research_interviews" ADD CONSTRAINT "founding_research_interviews_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "founding_program_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "founding_research_interviews" ADD CONSTRAINT "founding_research_interviews_interviewerAdminId_fkey" FOREIGN KEY ("interviewerAdminId") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

UPDATE "businesses" SET "isDemo" = true WHERE "slug" = 'kings-store-demo';
