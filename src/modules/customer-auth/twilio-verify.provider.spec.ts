import { describe, expect, it, vi } from "vitest";
import type { WhatsAppProvider } from "../messaging/whatsapp-provider";
import { TwilioVerifyProvider } from "./twilio-verify.provider";

describe("TwilioVerifyProvider boundary", () => {
  it("delegates OTP start and verification to the shared WhatsApp provider", async () => {
    const whatsapp = {
      sendOtp: vi.fn().mockResolvedValue({
        provider: "internal-sandbox",
        reference: "sandbox:salt:hashed-code",
        expiresAt: new Date("2026-07-16T12:10:00.000Z"),
      }),
      verifyOtp: vi.fn().mockResolvedValue(true),
    } as unknown as WhatsAppProvider;
    const provider = new TwilioVerifyProvider(whatsapp);

    await expect(provider.start("+2348012345678")).resolves.toMatchObject({
      provider: "internal-sandbox",
    });
    await expect(
      provider.verify(
        "sandbox:salt:hashed-code",
        "+2348012345678",
        "123456",
      ),
    ).resolves.toBe(true);
    expect(whatsapp.sendOtp).toHaveBeenCalledWith("+2348012345678");
    expect(whatsapp.verifyOtp).toHaveBeenCalledWith(
      "sandbox:salt:hashed-code",
      "+2348012345678",
      "123456",
    );
  });
});
