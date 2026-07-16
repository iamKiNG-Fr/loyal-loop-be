-- Additive support for approved follow-up reminders in the existing
-- consent-aware WhatsApp outbox. This migration does not enable a provider.
ALTER TYPE "MessagePurpose" ADD VALUE 'REMINDER';
