import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TwilioWhatsAppProvider } from "./twilio-whatsapp.provider";

describe("TwilioWhatsAppProvider modes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts in Sandbox mode without production MG, VA, or HX SIDs", () => {
    const provider = new TwilioWhatsAppProvider(config(sandboxValues()));

    expect(() => provider.onModuleInit()).not.toThrow();
    expect(provider.status()).toEqual({
      whatsappMode: "sandbox",
      messagingConfigured: true,
      otpProvider: "internal-sandbox",
    });
  });

  it("sends Sandbox receipts as development-labelled text with the secure link", async () => {
    const fetchMock = successfulMessageFetch();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TwilioWhatsAppProvider(config(sandboxValues()));

    await provider.sendReceipt("+2348012345678", {
      "1": "Ada",
      "2": "King's Store",
      "3": "RCPT-123",
      "4": "https://www.useloyalloop.com/receipt/opaque-token",
    });

    const body = requestBody(fetchMock);
    expect(body.get("From")).toBe("whatsapp:+14155238886");
    expect(body.get("To")).toBe("whatsapp:+2348012345678");
    expect(body.get("Body")).toContain("DEVELOPMENT SANDBOX");
    expect(body.get("Body")).toContain(
      "https://www.useloyalloop.com/receipt/opaque-token",
    );
    expect(body.has("ContentSid")).toBe(false);
  });

  it("does not call Twilio for a Sandbox recipient not recorded as joined", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TwilioWhatsAppProvider(config(sandboxValues()));

    await expect(
      provider.sendDeliveryUpdate("+2348099999999", {}),
    ).rejects.toThrow("has not joined this Sandbox");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps Sandbox tracking links and reminder content in test messages", async () => {
    const fetchMock = successfulMessageFetch();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TwilioWhatsAppProvider(config(sandboxValues()));

    await provider.sendDeliveryUpdate("+2348012345678", {
      "1": "Ada",
      "2": "King's Store",
      "3": "ORDER-123",
      "4": "out for delivery",
      "5": "https://www.useloyalloop.com/delivery/opaque-token",
    });
    await provider.sendReminder("+2348012345678", {
      "1": "Ada",
      "2": "King's Store",
      "3": "Your order is waiting for collection.",
    });

    expect(requestBody(fetchMock, 0).get("Body")).toContain(
      "https://www.useloyalloop.com/delivery/opaque-token",
    );
    expect(requestBody(fetchMock, 1).get("Body")).toContain(
      "Your order is waiting for collection.",
    );
  });

  it("stores only a salted Sandbox OTP digest and validates the delivered code", async () => {
    const fetchMock = successfulMessageFetch();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TwilioWhatsAppProvider(config(sandboxValues()));

    const started = await provider.sendOtp("+2348012345678");
    const deliveredBody = requestBody(fetchMock).get("Body") || "";
    const code = deliveredBody.match(/\b(\d{6})\b/)?.[1];

    expect(started.provider).toBe("internal-sandbox");
    expect(code).toMatch(/^\d{6}$/);
    expect(started.reference).toMatch(/^sandbox:[^:]+:[0-9a-f]{64}$/);
    expect(started.reference).not.toContain(code);
    await expect(
      provider.verifyOtp(
        started.reference,
        "+2348012345678",
        code as string,
      ),
    ).resolves.toBe(true);
    await expect(
      provider.verifyOtp(started.reference, "+2348012345678", "000000"),
    ).resolves.toBe(false);
  });

  it("returns a clear Sandbox enrollment error for Twilio error 63015", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { code: 63015, message: "Channel Sandbox recipient error" },
          400,
        ),
      ),
    );
    const provider = new TwilioWhatsAppProvider(config(sandboxValues()));

    await expect(
      provider.sendMessage("+2348012345678", "test"),
    ).rejects.toThrow("has not joined this Sandbox");
  });

  it("returns a clear development error when the Sandbox transport is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const provider = new TwilioWhatsAppProvider(config(sandboxValues()));

    await expect(
      provider.sendOtp("+2348012345678"),
    ).rejects.toThrow("Development WhatsApp Sandbox is temporarily unreachable");
  });

  it("requires every registered-sender production dependency at startup", () => {
    const provider = new TwilioWhatsAppProvider(
      config({ TWILIO_WHATSAPP_MODE: "production", NODE_ENV: "development" }),
    );

    expect(() => provider.onModuleInit()).toThrow(
      /missing TWILIO_MESSAGING_SERVICE_SID/,
    );
    expect(() => provider.onModuleInit()).toThrow(
      /missing TWILIO_VERIFY_SERVICE_SID/,
    );
    expect(() => provider.onModuleInit()).toThrow(
      /missing TWILIO_REMINDER_CONTENT_SID/,
    );
  });

  it("rejects Sandbox mode in a production runtime without an explicit staging override", () => {
    const provider = new TwilioWhatsAppProvider(
      config({ ...sandboxValues(), NODE_ENV: "production" }),
    );

    expect(() => provider.onModuleInit()).toThrow("development-only");
  });

  it("does not treat an isolated database label as deployed Sandbox authorization", () => {
    const provider = new TwilioWhatsAppProvider(
      config({
        ...sandboxValues(),
        NODE_ENV: "production",
        DATABASE_SAFETY_MODE: "isolated",
      }),
    );

    expect(() => provider.onModuleInit()).toThrow(
      "TWILIO_WHATSAPP_ALLOW_DEPLOYED_SANDBOX=true",
    );
  });

  it("allows Sandbox OTP against a live database after the explicit deployed override", async () => {
    const fetchMock = successfulMessageFetch();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TwilioWhatsAppProvider(
      config({
        ...sandboxValues(),
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://remote-placeholder/production",
        DATABASE_SAFETY_MODE: "production",
        TWILIO_WHATSAPP_ALLOW_DEPLOYED_SANDBOX: "true",
      }),
    );

    expect(() => provider.onModuleInit()).not.toThrow();
    await expect(provider.sendOtp("+2348012345678")).resolves.toMatchObject({
      provider: "internal-sandbox",
    });
    expect(requestBody(fetchMock).get("Body")).toContain(
      "LOYAL LOOP DEVELOPMENT SANDBOX",
    );
  });

  it("uses the production sender, Messaging Service, and approved receipt Content SID", async () => {
    const fetchMock = successfulMessageFetch();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TwilioWhatsAppProvider(config(productionValues()));
    provider.onModuleInit();

    await provider.sendReceipt("+2348012345678", {
      "1": "Ada",
      "4": "https://www.useloyalloop.com/receipt/opaque-token",
    });

    const body = requestBody(fetchMock);
    expect(body.get("From")).toBe("whatsapp:+2349012345678");
    expect(body.get("MessagingServiceSid")).toBe(`MG${"b".repeat(32)}`);
    expect(body.get("ContentSid")).toBe(`HX${"d".repeat(32)}`);
    expect(body.has("Body")).toBe(false);
  });

  it("retains the approved production reminder Content Template path", async () => {
    const fetchMock = successfulMessageFetch();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TwilioWhatsAppProvider(config(productionValues()));
    provider.onModuleInit();

    await provider.sendReminder("+2348012345678", {
      "1": "Ada",
      "2": "King's Store",
      "3": "Your order is waiting for collection.",
    });

    const body = requestBody(fetchMock);
    expect(body.get("MessagingServiceSid")).toBe(`MG${"b".repeat(32)}`);
    expect(body.get("ContentSid")).toBe(`HX${"f".repeat(32)}`);
    expect(body.has("Body")).toBe(false);
  });

  it("keeps production OTP delivery and validation on Twilio Verify WhatsApp", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ sid: "VEverification", status: "pending" }, 201))
      .mockResolvedValueOnce(jsonResponse({ sid: "VEverification", status: "approved" }, 200));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new TwilioWhatsAppProvider(config(productionValues()));
    provider.onModuleInit();

    const started = await provider.sendOtp("+2348012345678");
    const approved = await provider.verifyOtp(
      started.reference,
      "+2348012345678",
      "123456",
    );

    expect(started.provider).toBe("twilio-verify");
    expect(approved).toBe(true);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      `/Services/VA${"c".repeat(32)}/Verifications`,
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `/Services/VA${"c".repeat(32)}/VerificationCheck`,
    );
  });
});

function sandboxValues() {
  return {
    TWILIO_WHATSAPP_MODE: "sandbox",
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://local-placeholder@localhost:5432/loyalloop",
    SESSION_HASH_SECRET: "test-session-hash-secret",
    TWILIO_ACCOUNT_SID: "ACsandbox",
    TWILIO_AUTH_TOKEN: "sandbox-auth-token",
    TWILIO_WHATSAPP_SANDBOX_FROM: "whatsapp:+14155238886",
    TWILIO_WHATSAPP_SANDBOX_JOINED_NUMBERS: "+2348012345678",
    TWILIO_WHATSAPP_WEBHOOK_URL:
      "https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio",
    TWILIO_WHATSAPP_ENABLED: "true",
    TWILIO_WHATSAPP_VERIFY_ENABLED: "true",
    TWILIO_WHATSAPP_KILL_SWITCH: "false",
  };
}

function productionValues() {
  return {
    TWILIO_WHATSAPP_MODE: "production",
    NODE_ENV: "production",
    TWILIO_ACCOUNT_SID: `AC${"a".repeat(32)}`,
    TWILIO_AUTH_TOKEN: "production-auth-token",
    TWILIO_WHATSAPP_SENDER: "+2349012345678",
    TWILIO_MESSAGING_SERVICE_SID: `MG${"b".repeat(32)}`,
    TWILIO_VERIFY_SERVICE_SID: `VA${"c".repeat(32)}`,
    TWILIO_RECEIPT_CONTENT_SID: `HX${"d".repeat(32)}`,
    TWILIO_DELIVERY_CONTENT_SID: `HX${"e".repeat(32)}`,
    TWILIO_REMINDER_CONTENT_SID: `HX${"f".repeat(32)}`,
    TWILIO_WHATSAPP_WEBHOOK_URL:
      "https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio",
    TWILIO_WHATSAPP_PILOT_ALLOWLIST: "+2348012345678",
    TWILIO_WHATSAPP_ENABLED: "true",
    TWILIO_WHATSAPP_VERIFY_ENABLED: "true",
    TWILIO_WHATSAPP_KILL_SWITCH: "false",
    TWILIO_WHATSAPP_PRODUCTION_READY: "true",
  };
}

function config(values: Record<string, string>) {
  return {
    get(key: string, fallback?: string) {
      return values[key] ?? fallback;
    },
    getOrThrow(key: string) {
      const value = values[key];
      if (!value) throw new Error(`Missing ${key}`);
      return value;
    },
  } as ConfigService;
}

function successfulMessageFetch() {
  return vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ sid: "SMmessage", status: "queued" }, 201),
      ),
    );
}

function jsonResponse(value: unknown, status: number) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const init = fetchMock.mock.calls[call]?.[1] as RequestInit;
  return new URLSearchParams(String(init.body));
}
