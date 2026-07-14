import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizePhone, verifyTwilioSignature } from "./messaging.service";

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
