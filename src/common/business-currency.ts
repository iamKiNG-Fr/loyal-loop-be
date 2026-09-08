import { BadRequestException } from "@nestjs/common";

export const businessRegions = {
  NG: { currency: "NGN", timezone: "Africa/Lagos" },
  GH: { currency: "GHS", timezone: "Africa/Accra" },
  KE: { currency: "KES", timezone: "Africa/Nairobi" },
  ZA: { currency: "ZAR", timezone: "Africa/Johannesburg" },
} as const;

export function businessCurrency(value = "NGN") {
  const currency = value.trim().toUpperCase();
  if (!["NGN", "GHS", "KES", "ZAR", "USD", "GBP"].includes(currency)) {
    throw new BadRequestException("Choose a supported business currency");
  }
  return currency;
}

export function assertSameCurrency(expected: string, actual?: string | null) {
  if (actual && actual !== expected) {
    throw new BadRequestException("Products and payment details must use the shop currency. Currency conversion is not available.");
  }
}
