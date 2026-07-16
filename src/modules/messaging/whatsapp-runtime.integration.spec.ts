import type { INestApplication } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagingController } from "./messaging.controller";
import { MessagingService } from "./messaging.service";
import { TwilioWhatsAppProvider } from "./twilio-whatsapp.provider";
import { PrismaService } from "../prisma/prisma.service";

describe("WhatsApp runtime HTTP integration", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it.each([
    ["sandbox", sandboxValues(), "internal-sandbox"],
    ["production", productionValues(), "twilio-verify"],
  ] as const)(
    "exposes non-sensitive %s configuration status behind the real API prefix",
    async (mode, values, otpProvider) => {
      const runtime = new TwilioWhatsAppProvider(config(values));
      runtime.onModuleInit();
      const service = {
        status: () => runtime.status(),
      };
      app = await createApp(service);

      const response = await request(app.getHttpServer())
        .get("/api/v1/messaging/status")
        .expect(200);

      expect(response.body.data).toEqual({
        whatsappMode: mode,
        messagingConfigured: true,
        otpProvider,
      });
      expect(JSON.stringify(response.body)).not.toContain("auth-token");
      expect(JSON.stringify(response.body)).not.toContain("HX");
    },
  );

  it("keeps the Twilio webhook at the deployed POST URL", async () => {
    const handleTwilioWebhook = vi
      .fn()
      .mockResolvedValue({ accepted: true, duplicate: false });
    app = await createApp({
      status: () => ({
        whatsappMode: "sandbox",
        messagingConfigured: true,
        otpProvider: "internal-sandbox",
      }),
      handleTwilioWebhook,
    });

    await request(app.getHttpServer())
      .post("/api/v1/messaging/webhooks/twilio")
      .set("x-twilio-signature", "signed-request")
      .type("form")
      .send({ MessageSid: "SM123", MessageStatus: "delivered" })
      .expect(201);

    expect(handleTwilioWebhook).toHaveBeenCalledWith("signed-request", {
      MessageSid: "SM123",
      MessageStatus: "delivered",
    });
  });
});

async function createApp(service: Partial<MessagingService>) {
  const moduleRef = await Test.createTestingModule({
    controllers: [MessagingController],
    providers: [
      { provide: MessagingService, useValue: service },
      { provide: PrismaService, useValue: {} },
    ],
  }).compile();
  const instance = moduleRef.createNestApplication();
  instance.setGlobalPrefix("api/v1");
  await instance.init();
  return instance;
}

function sandboxValues() {
  return {
    TWILIO_WHATSAPP_MODE: "sandbox",
    NODE_ENV: "development",
    TWILIO_ACCOUNT_SID: "ACsandbox",
    TWILIO_AUTH_TOKEN: "sandbox-auth-token",
    TWILIO_WHATSAPP_SANDBOX_FROM: "whatsapp:+14155238886",
    TWILIO_WHATSAPP_SANDBOX_JOINED_NUMBERS: "+2348012345678",
    TWILIO_WHATSAPP_WEBHOOK_URL:
      "https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio",
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
