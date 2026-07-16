import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MessagingService, normalizePhone, verifyTwilioSignature } from "./messaging.service";

describe("Twilio webhook security", () => {
  it("validates the exact callback URL plus sorted form values", () => {
    const token = "private-test-token";
    const url = "https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio";
    const values = { MessageSid: "SM123", MessageStatus: "delivered" };
    const signed = `${url}MessageSidSM123MessageStatusdelivered`;
    const signature = createHmac("sha1", token).update(signed).digest("base64");
    expect(verifyTwilioSignature(token, url, values, signature)).toBe(true);
    expect(verifyTwilioSignature(token, url, { ...values, MessageStatus: "failed" }, signature)).toBe(false);
  });

  it("normalizes Twilio and human-formatted phone addresses consistently", () => {
    expect(normalizePhone("whatsapp:+234 (801) 234-5678")).toBe("+2348012345678");
  });
});

describe("WhatsApp consent", () => {
  it("records explicit order-journey consent against the normalized phone", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const service = new MessagingService(
      { messagingConsent: { upsert } } as never,
      { get: vi.fn(() => "test-session-secret") } as never,
      {} as never,
    );

    await service.grantPhoneConsent(
      "whatsapp:+234 (801) 234-5678",
      "DELIVERY",
      "order-request",
      "customer-account-1",
    );

    expect(upsert).toHaveBeenCalledWith({
      where: {
        phoneHash_purpose: {
          phoneHash: expect.any(String),
          purpose: "DELIVERY",
        },
      },
      create: expect.objectContaining({
        customerAccountId: "customer-account-1",
        purpose: "DELIVERY",
        source: "order-request",
      }),
      update: expect.objectContaining({
        customerAccountId: "customer-account-1",
        revokedAt: null,
        source: "order-request",
      }),
    });
  });
});
