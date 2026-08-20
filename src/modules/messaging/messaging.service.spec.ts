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

  it("queues one consented social launch message per customer and launch moment", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "outbox-1", status: "PENDING" });
    const service = new MessagingService(
      {
        messageOutbox: { upsert },
        messagingConsent: { findUnique: vi.fn().mockResolvedValue({ revokedAt: null }) },
        messagingSuppression: { findUnique: vi.fn().mockResolvedValue(null) },
      } as never,
      { get: vi.fn((key: string) => key === "SESSION_HASH_SECRET" ? "test-session-secret" : undefined) } as never,
      {} as never,
      {} as never,
    );
    const launchAt = new Date("2026-08-15T12:00:00.000Z");

    await service.enqueueProductLaunch({
      businessId: "business-1",
      businessName: "King's Store",
      customerAccountId: "customer-1",
      customerName: "Ada",
      launchAt,
      phone: "+2348012345678",
      productId: "product-1",
      productName: "Ankara Haven",
      url: "https://www.useloyalloop.com/shop/kings-store?product=product-1",
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        idempotencyKey: `product-launch:product-1:${launchAt.getTime()}:customer-1`,
        payload: expect.objectContaining({ "3": expect.stringContaining("just dropped 🎉") }),
        purpose: "REMINDER",
        status: "PENDING",
      }),
    }));
  });
});

describe("WhatsApp inbound replies", () => {
  it("saves a quoted customer-memory reply against the matching customer", async () => {
    const customerNoteCreate = vi.fn().mockResolvedValue({ id: "note-1" });
    const activityRecord = vi.fn().mockResolvedValue({ id: "activity-1" });
    const sendMessage = vi.fn().mockResolvedValue({
      sid: "SMack",
      status: "queued",
      provider: "twilio-whatsapp-production",
    });
    const prisma = {
      messagingWebhookEvent: {
        upsert: vi.fn().mockResolvedValue({ id: "event-1", processedAt: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      messageOutbox: {
        findFirst: vi.fn().mockResolvedValue({
          businessId: "business-1",
          recipientUserId: "owner-1",
          toAddress: "+2348012345678",
          payload: {
            "1": "Ada",
            "2": "Amaka",
            _context: {
              customerId: "customer-1",
              deliveryId: "delivery-1",
            },
          },
        }),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue({ id: "customer-1", name: "Amaka" }),
      },
      customerNote: { create: customerNoteCreate },
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    };
    const service = new MessagingService(
      prisma as never,
      webhookConfig() as never,
      { sendMessage } as never,
      { record: activityRecord } as never,
    );
    const values = {
      MessageSid: "SMreply",
      From: "whatsapp:+2348012345678",
      Body: "Prefers size 42 and evening delivery.",
      OriginalRepliedMessageSid: "SMprompt",
    };

    await service.handleTwilioWebhook(webhookSignature(values), values);

    expect(prisma.messageOutbox.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          providerReference: "SMprompt",
          templateKey: "customer_memory",
        },
      }),
    );
    expect(customerNoteCreate).toHaveBeenCalledWith({
      data: {
        customerId: "customer-1",
        authorId: "owner-1",
        content: "Prefers size 42 and evening delivery.",
      },
    });
    expect(activityRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: "business-1",
        customerId: "customer-1",
        deliveryId: "delivery-1",
        type: "CUSTOMER_NOTE_ADDED",
      }),
      prisma,
    );
    expect(sendMessage).toHaveBeenCalledWith(
      "whatsapp:+2348012345678",
      "Saved to Amaka's customer memory.",
    );
  });

  it("does not treat an ordinary unquoted WhatsApp message as a customer note", async () => {
    const findFirst = vi.fn();
    const values = {
      MessageSid: "SMordinary",
      From: "whatsapp:+2348012345678",
      Body: "Prefers size 42.",
    };
    const service = new MessagingService(
      {
        messagingWebhookEvent: {
          upsert: vi.fn().mockResolvedValue({ id: "event-2", processedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        messageOutbox: { findFirst },
      } as never,
      webhookConfig() as never,
      { sendMessage: vi.fn() } as never,
      { record: vi.fn() } as never,
    );

    await service.handleTwilioWebhook(webhookSignature(values), values);

    expect(findFirst).not.toHaveBeenCalled();
  });

  it("enforces Twilio STOP events even when the message body is not the keyword", async () => {
    const suppressionUpsert = vi.fn().mockResolvedValue({});
    const values = {
      MessageSid: "SMstop",
      From: "whatsapp:+2348012345678",
      Body: "Please stop these updates",
      OptOutType: "STOP",
    };
    const service = new MessagingService(
      {
        messagingWebhookEvent: {
          upsert: vi.fn().mockResolvedValue({ id: "event-3", processedAt: null }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        messagingSuppression: { upsert: suppressionUpsert },
      } as never,
      webhookConfig() as never,
      { sendMessage: vi.fn() } as never,
      { record: vi.fn() } as never,
    );

    await service.handleTwilioWebhook(webhookSignature(values), values);

    expect(suppressionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ source: "twilio-inbound" }),
      }),
    );
  });
});

function webhookConfig() {
  return {
    get(key: string, fallback?: string) {
      if (key === "TWILIO_WHATSAPP_WEBHOOK_URL") {
        return "https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio";
      }
      if (key === "TWILIO_AUTH_TOKEN") return "private-test-token";
      if (key === "SESSION_HASH_SECRET") return "test-session-secret";
      return fallback;
    },
  };
}

function webhookSignature(values: Record<string, string | undefined>) {
  const url = "https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio";
  const signed = Object.keys(values)
    .sort()
    .reduce((result, key) => `${result}${key}${values[key] ?? ""}`, url);
  return createHmac("sha1", "private-test-token")
    .update(signed)
    .digest("base64");
}
