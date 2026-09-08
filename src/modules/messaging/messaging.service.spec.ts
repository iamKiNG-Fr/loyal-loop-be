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

describe("Commerce journey WhatsApp payloads", () => {
  it("uses an opaque request journey link and the customer-facing rejection reason", async () => {
    const outboxUpsert = vi.fn().mockResolvedValue({ id: "outbox-1", status: "SUPPRESSED" });
    const shareTokenCreate = vi.fn().mockResolvedValue({ id: "token-1" });
    const service = new MessagingService(
      {
        messageOutbox: { upsert: outboxUpsert },
        messagingConsent: { findUnique: vi.fn().mockResolvedValue(null) },
        messagingSuppression: { findUnique: vi.fn().mockResolvedValue(null) },
        orderRequest: {
          findUnique: vi.fn().mockResolvedValue({
            business: { name: "King's Store" },
            businessId: "business-1",
            customerAccountId: "account-1",
            customerName: "Ada",
            customerPhone: "+2348012345678",
            id: "request-1",
            referenceCode: "REQ-PUBLIC-CODE",
          }),
        },
        orderRequestShareToken: { create: shareTokenCreate },
      } as never,
      utilityConfig() as never,
      {} as never,
      {} as never,
    );

    await service.enqueuePaymentProofRejected(
      "request-1",
      "proof-1",
      "The amount does not match the receipt",
    );

    expect(shareTokenCreate).toHaveBeenCalledWith({
      data: { orderRequestId: "request-1", tokenHash: expect.any(String) },
    });
    const create = outboxUpsert.mock.calls[0]?.[0]?.create;
    expect(create.payload["4"]).toContain("The amount does not match the receipt");
    expect(create.payload["5"]).toMatch(/^https:\/\/www\.useloyalloop\.com\/request\/[A-Za-z0-9_-]+$/);
    expect(create.payload["5"]).not.toContain("REQ-PUBLIC-CODE");
    expect(create.idempotencyKey).toBe("payment-proof-rejected:proof-1");
  });

  it("includes the delivery service and rider details in an in-transit update", async () => {
    const outboxUpsert = vi.fn().mockResolvedValue({ id: "outbox-2", status: "SUPPRESSED" });
    const service = new MessagingService(
      {
        delivery: {
          findFirst: vi.fn().mockResolvedValue({
            business: { name: "King's Store" },
            businessId: "business-1",
            courierName: "Tobi",
            courierPhone: "+2348012345678",
            courierService: "Shop delivery",
            customer: { accountId: "account-1", name: "Ada", phone: "+2348099999999" },
            id: "delivery-1",
            sale: { referenceCode: "LL-ORDER-1" },
            status: "IN_TRANSIT",
            updatedAt: new Date("2026-08-24T08:00:00.000Z"),
          }),
        },
        deliveryShareToken: { create: vi.fn().mockResolvedValue({ id: "token-2" }) },
        messageOutbox: { upsert: outboxUpsert },
        messagingConsent: { findUnique: vi.fn().mockResolvedValue(null) },
        messagingSuppression: { findUnique: vi.fn().mockResolvedValue(null) },
      } as never,
      utilityConfig() as never,
      {} as never,
      {} as never,
    );

    await service.enqueueDelivery(
      { businessId: "business-1", userId: "owner-1" },
      "delivery-1",
    );

    const create = outboxUpsert.mock.calls[0]?.[0]?.create;
    expect(create.payload["4"]).toBe(
      "In transit with Shop delivery. Rider: Tobi, +2348012345678. Open your order page for the private handoff code. Share it only after receiving your package.",
    );
    expect(create.payload["5"]).toMatch(/^https:\/\/www\.useloyalloop\.com\/delivery\/[A-Za-z0-9_-]+$/);
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

function utilityConfig() {
  return {
    get(key: string, fallback?: string) {
      if (key === "APP_URL") return "https://www.useloyalloop.com";
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
