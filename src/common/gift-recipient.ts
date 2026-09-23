import { BadRequestException } from "@nestjs/common";

// Accept familiar phone punctuation, but never letters or arbitrary identifiers.
export const RECIPIENT_PHONE_PATTERN = /^(?=(?:\D*\d){7,15}\D*$)\+?[\d ()-]+$/;
export const OPTIONAL_RECIPIENT_PHONE_PATTERN = /^(?:|(?=(?:\D*\d){7,15}\D*$)\+?[\d ()-]+)$/;
export const RECIPIENT_PHONE_MESSAGE = "Use a recipient phone number with 7–15 digits, not letters";

export function validateGiftRecipient(value: { isGift?: boolean; recipientName?: string | null; recipientPhone?: string | null }) {
  if (!value.isGift) return;
  if (!value.recipientName?.trim()) throw new BadRequestException("Add the gift recipient’s name");
  if (!RECIPIENT_PHONE_PATTERN.test(value.recipientPhone?.trim() || "")) throw new BadRequestException(RECIPIENT_PHONE_MESSAGE);
}
