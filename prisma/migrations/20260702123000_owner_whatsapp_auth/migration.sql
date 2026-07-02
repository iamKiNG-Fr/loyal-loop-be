-- Business-owner WhatsApp sign-in is available only to the primary WhatsApp
-- number attached to that owner's workspace.

WITH candidate_numbers AS (
  SELECT
    b."ownerId" AS "userId",
    ('+' || regexp_replace(c.value, '\D', '', 'g')) AS phone,
    row_number() OVER (
      PARTITION BY ('+' || regexp_replace(c.value, '\D', '', 'g'))
      ORDER BY b."createdAt" ASC
    ) AS duplicate_rank
  FROM "businesses" b
  INNER JOIN "business_contacts" c
    ON c."businessId" = b.id
  WHERE c.platform = 'WHATSAPP'
    AND c."isPrimary" = true
    AND length(regexp_replace(c.value, '\D', '', 'g')) BETWEEN 8 AND 15
)
UPDATE "users" u
SET phone = candidate_numbers.phone
FROM candidate_numbers
WHERE u.id = candidate_numbers."userId"
  AND u.phone IS NULL
  AND candidate_numbers.duplicate_rank = 1;

UPDATE "users"
SET phone = CASE
  WHEN length(regexp_replace(phone, '\D', '', 'g')) BETWEEN 8 AND 15
    THEN ('+' || regexp_replace(phone, '\D', '', 'g'))
  ELSE NULL
END
WHERE phone IS NOT NULL;

WITH duplicate_phones AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY phone ORDER BY "createdAt" ASC) AS duplicate_rank
  FROM "users"
  WHERE phone IS NOT NULL
)
UPDATE "users" u
SET phone = NULL
FROM duplicate_phones
WHERE u.id = duplicate_phones.id
  AND duplicate_phones.duplicate_rank > 1;

CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

CREATE TABLE "owner_otp_challenges" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "phone" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerReference" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "owner_otp_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "owner_otp_challenges_providerReference_key"
  ON "owner_otp_challenges"("providerReference");

CREATE INDEX "owner_otp_challenges_phone_createdAt_idx"
  ON "owner_otp_challenges"("phone", "createdAt");

ALTER TABLE "owner_otp_challenges"
  ADD CONSTRAINT "owner_otp_challenges_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "users"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
