-- Platform administration is a separate security boundary. Existing sessions
-- remain linked to their owner session, while new admin-only sessions and
-- passkey challenges no longer require a business workspace session.
ALTER TABLE "platform_admin_sessions"
ALTER COLUMN "ownerSessionId" DROP NOT NULL;

ALTER TABLE "platform_admin_passkey_challenges"
ALTER COLUMN "ownerSessionId" DROP NOT NULL;
