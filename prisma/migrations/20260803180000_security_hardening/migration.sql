CREATE TYPE "PlatformAdminAuthenticationMethod" AS ENUM ('WHATSAPP_OTP', 'PASSKEY', 'RECOVERY_CODE');
CREATE TYPE "PlatformAdminPasskeyChallengePurpose" AS ENUM ('REGISTRATION', 'AUTHENTICATION');

ALTER TABLE "platform_admin_sessions"
ADD COLUMN "passkeyId" TEXT,
ADD COLUMN "authenticationMethod" "PlatformAdminAuthenticationMethod" NOT NULL DEFAULT 'WHATSAPP_OTP',
ADD COLUMN "userAgent" TEXT,
ADD COLUMN "ipHash" TEXT;

CREATE TABLE "platform_admin_passkeys" (
    "id" TEXT NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "deviceType" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "platform_admin_passkeys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_admin_passkey_challenges" (
    "id" TEXT NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "ownerSessionId" TEXT NOT NULL,
    "purpose" "PlatformAdminPasskeyChallengePurpose" NOT NULL,
    "challenge" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_admin_passkey_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_admin_recovery_codes" (
    "id" TEXT NOT NULL,
    "platformAdminId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_admin_passkeys_credentialId_key" ON "platform_admin_passkeys"("credentialId");
CREATE INDEX "platform_admin_passkeys_platformAdminId_createdAt_idx" ON "platform_admin_passkeys"("platformAdminId", "createdAt");
CREATE UNIQUE INDEX "platform_admin_passkey_challenges_challenge_key" ON "platform_admin_passkey_challenges"("challenge");
CREATE INDEX "platform_admin_passkey_challenges_platformAdminId_purpose_expiresAt_idx" ON "platform_admin_passkey_challenges"("platformAdminId", "purpose", "expiresAt");
CREATE INDEX "platform_admin_passkey_challenges_ownerSessionId_usedAt_idx" ON "platform_admin_passkey_challenges"("ownerSessionId", "usedAt");
CREATE UNIQUE INDEX "platform_admin_recovery_codes_codeHash_key" ON "platform_admin_recovery_codes"("codeHash");
CREATE INDEX "platform_admin_recovery_codes_platformAdminId_usedAt_idx" ON "platform_admin_recovery_codes"("platformAdminId", "usedAt");

ALTER TABLE "platform_admin_sessions"
ADD CONSTRAINT "platform_admin_sessions_passkeyId_fkey"
FOREIGN KEY ("passkeyId") REFERENCES "platform_admin_passkeys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "platform_admin_passkeys"
ADD CONSTRAINT "platform_admin_passkeys_platformAdminId_fkey"
FOREIGN KEY ("platformAdminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_admin_passkey_challenges"
ADD CONSTRAINT "platform_admin_passkey_challenges_platformAdminId_fkey"
FOREIGN KEY ("platformAdminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_admin_passkey_challenges"
ADD CONSTRAINT "platform_admin_passkey_challenges_ownerSessionId_fkey"
FOREIGN KEY ("ownerSessionId") REFERENCES "owner_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "platform_admin_recovery_codes"
ADD CONSTRAINT "platform_admin_recovery_codes_platformAdminId_fkey"
FOREIGN KEY ("platformAdminId") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
