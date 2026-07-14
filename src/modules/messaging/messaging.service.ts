import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { hashPrivateValue } from "../../common/crypto.util";
import { createOpaqueToken } from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { PrismaService } from "../prisma/prisma.service";

type UtilityPurpose = "RECEIPT" | "DELIVERY";
type WebhookValues = Record<string, string | undefined>;

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async consentState(customerAccountId: string) {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({
      where: { id: customerAccountId },
      select: { phone: true },
    });
    const phoneHash = this.phoneHash(account.phone);
    const [consents, suppression] = await Promise.all([
      this.prisma.messagingConsent.findMany({
        where: { phoneHash },
        select: { purpose: true, grantedAt: true, revokedAt: true, source: true },
      }),
      this.prisma.messagingSuppression.findUnique({
        where: { phoneHash },
        select: { reason: true, createdAt: true },
      }),
    ]);
    return { consents, suppressed: Boolean(suppression), suppression };
  }

  async grantConsent(customerAccountId: string, purpose: UtilityPurpose) {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({
      where: { id: customerAccountId },
      select: { phone: true },
    });
    const phoneHash = this.phoneHash(account.phone);
    await this.prisma.messagingConsent.upsert({
      where: { phoneHash_purpose: { phoneHash, purpose } },
      create: {
        customerAccountId,
        phoneHash,
        purpose,
        source: "customer-settings",
      },
      update: {
        customerAccountId,
        source: "customer-settings",
        grantedAt: new Date(),
        revokedAt: null,
      },
    });
    return this.consentState(customerAccountId);
  }

  async revokeConsent(customerAccountId: string, purpose: UtilityPurpose) {
    const account = await this.prisma.customerAccount.findUniqueOrThrow({
      where: { id: customerAccountId },
      select: { phone: true },
    });
    await this.prisma.messagingConsent.updateMany({
      where: { phoneHash: this.phoneHash(account.phone), purpose, revokedAt: null },
      data: { revokedAt: new Date(), source: "customer-settings" },
    });
    return this.consentState(customerAccountId);
  }

  async enqueueUtility(input: {
    customerAccountId?: string;
    businessId?: string;
    phone: string;
    purpose: UtilityPurpose;
    templateKey: string;
    variables: Record<string, string>;
    idempotencyKey: string;
  }) {
    const phone = normalizePhone(input.phone);
    const phoneHash = this.phoneHash(phone);
    const [consent, suppression] = await Promise.all([
      this.prisma.messagingConsent.findUnique({
        where: { phoneHash_purpose: { phoneHash, purpose: input.purpose } },
      }),
      this.prisma.messagingSuppression.findUnique({ where: { phoneHash } }),
    ]);
    const permitted = consent && !consent.revokedAt && !suppression;
    const record = await this.prisma.messageOutbox.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create: {
        customerAccountId: input.customerAccountId,
        businessId: input.businessId,
        toAddress: phone,
        purpose: input.purpose,
        templateKey: input.templateKey,
        payload: input.variables,
        idempotencyKey: input.idempotencyKey,
        status: permitted ? "PENDING" : "SUPPRESSED",
        lastError: permitted ? null : "Consent missing, revoked, or recipient suppressed",
      },
      update: {},
    });

    if (record.status === "PENDING" && this.pilotEnabled()) {
      void this.processOne(record.id).catch(() => undefined);
    }
    return { id: record.id, status: record.status };
  }

  async enqueueReceipt(auth: OwnerAuthContext, receiptId: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { id: receiptId, businessId: auth.businessId, status: { not: "VOID" } },
      include: { business: true, customer: true },
    });
    if (!receipt || !receipt.customer.phone) throw new BadRequestException("Receipt customer needs a WhatsApp phone number");
    const generated = createOpaqueToken();
    await this.prisma.$transaction([
      this.prisma.receiptShareToken.create({ data: { receiptId, tokenHash: generated.tokenHash } }),
      this.prisma.receipt.update({
        where: { id: receiptId },
        data: { status: receipt.status === "CREATED" ? "SENT" : undefined, sentAt: receipt.sentAt ?? new Date() },
      }),
    ]);
    const appUrl = this.config.get<string>("APP_URL", "https://www.useloyalloop.com").replace(/\/$/, "");
    return this.enqueueUtility({
      businessId: auth.businessId,
      customerAccountId: receipt.customer.accountId ?? undefined,
      phone: receipt.customer.phone,
      purpose: "RECEIPT",
      templateKey: "receipt",
      variables: { "1": receipt.customer.name, "2": receipt.business.name, "3": receipt.receiptCode, "4": `${appUrl}/receipt/${generated.token}` },
      idempotencyKey: `receipt:${receipt.id}:${receipt.updatedAt.getTime()}`,
    });
  }

  async enqueueDelivery(auth: OwnerAuthContext, deliveryId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, businessId: auth.businessId },
      include: { business: true, customer: true, sale: { select: { referenceCode: true } } },
    });
    if (!delivery || !delivery.customer.phone) throw new BadRequestException("Delivery customer needs a WhatsApp phone number");
    const generated = createOpaqueToken();
    await this.prisma.deliveryShareToken.create({ data: { deliveryId, tokenHash: generated.tokenHash } });
    const appUrl = this.config.get<string>("APP_URL", "https://www.useloyalloop.com").replace(/\/$/, "");
    return this.enqueueUtility({
      businessId: auth.businessId,
      customerAccountId: delivery.customer.accountId ?? undefined,
      phone: delivery.customer.phone,
      purpose: "DELIVERY",
      templateKey: "delivery",
      variables: { "1": delivery.customer.name, "2": delivery.business.name, "3": delivery.sale.referenceCode, "4": delivery.status.replace(/_/g, " ").toLowerCase(), "5": `${appUrl}/delivery/${generated.token}` },
      idempotencyKey: `delivery:${delivery.id}:${delivery.updatedAt.getTime()}`,
    });
  }

  async processDue(limit = 25) {
    this.assertWorkerEnabled();
    const due = await this.prisma.messageOutbox.findMany({
      where: {
        status: { in: ["PENDING", "FAILED"] },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { createdAt: "asc" },
      take: Math.min(Math.max(limit, 1), 100),
      select: { id: true },
    });
    const results = [];
    for (const item of due) results.push(await this.processOne(item.id));
    return {
      processed: results.length,
      sent: results.filter((item) => item === "SENT").length,
      failed: results.filter((item) => item === "FAILED" || item === "DEAD_LETTER").length,
      suppressed: results.filter((item) => item === "SUPPRESSED").length,
    };
  }

  async processOne(id: string) {
    this.assertWorkerEnabled();
    const outbox = await this.prisma.messageOutbox.findUniqueOrThrow({ where: { id } });
    if (!["PENDING", "FAILED"].includes(outbox.status)) return outbox.status;
    if (!this.recipientAllowed(outbox.toAddress)) {
      await this.prisma.messageOutbox.update({
        where: { id },
        data: { status: "SUPPRESSED", lastError: "Recipient is outside the private pilot allow-list" },
      });
      return "SUPPRESSED";
    }
    const phoneHash = this.phoneHash(outbox.toAddress);
    const [consent, suppression] = await Promise.all([
      this.prisma.messagingConsent.findUnique({
        where: { phoneHash_purpose: { phoneHash, purpose: outbox.purpose } },
      }),
      this.prisma.messagingSuppression.findUnique({ where: { phoneHash } }),
    ]);
    if (!consent || consent.revokedAt || suppression) {
      await this.prisma.messageOutbox.update({
        where: { id },
        data: { status: "SUPPRESSED", lastError: "Consent missing, revoked, or recipient suppressed" },
      });
      return "SUPPRESSED";
    }
    await this.assertDailyCap();
    await this.prisma.messageOutbox.update({ where: { id }, data: { status: "PROCESSING" } });

    try {
      const result = await this.sendTemplate(
        outbox.toAddress,
        outbox.templateKey,
        outbox.payload as Record<string, string>,
      );
      await this.prisma.$transaction([
        this.prisma.messageOutbox.update({
          where: { id },
          data: {
            status: "SENT",
            providerReference: result.sid,
            sentAt: new Date(),
            attemptCount: { increment: 1 },
            lastError: null,
          },
        }),
        this.prisma.messageAttempt.create({
          data: {
            outboxId: id,
            provider: "twilio-whatsapp",
            providerReference: result.sid,
            status: "SENT",
            metadata: { twilioStatus: result.status },
          },
        }),
      ]);
      return "SENT";
    } catch (error) {
      const attempts = outbox.attemptCount + 1;
      const terminal = attempts >= this.maxAttempts();
      const message = error instanceof Error ? error.message : "Twilio send failed";
      await this.prisma.$transaction([
        this.prisma.messageOutbox.update({
          where: { id },
          data: {
            status: terminal ? "DEAD_LETTER" : "FAILED",
            attemptCount: attempts,
            lastError: message.slice(0, 500),
            nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000),
          },
        }),
        this.prisma.messageAttempt.create({
          data: {
            outboxId: id,
            provider: "twilio-whatsapp",
            status: terminal ? "DEAD_LETTER" : "FAILED",
            error: message.slice(0, 500),
          },
        }),
      ]);
      return terminal ? "DEAD_LETTER" : "FAILED";
    }
  }

  assertWorkerSecret(value: string | undefined) {
    const expected = this.config.get<string>("MESSAGING_WORKER_SECRET");
    if (!expected || !value || !safeEqual(expected, value)) {
      throw new ForbiddenException("Invalid messaging worker credentials");
    }
  }

  async handleTwilioWebhook(signature: string | undefined, values: WebhookValues) {
    const webhookUrl = this.config.get<string>("TWILIO_WHATSAPP_WEBHOOK_URL");
    const authToken = this.config.get<string>("TWILIO_AUTH_TOKEN");
    if (!webhookUrl || !authToken || !signature || !verifyTwilioSignature(authToken, webhookUrl, values, signature)) {
      throw new ForbiddenException("Invalid Twilio webhook signature");
    }

    const sid = values.MessageSid || values.SmsSid;
    const inboundBody = values.Body?.trim().toUpperCase();
    if (values.From && inboundBody && ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(inboundBody)) {
      const phoneHash = this.phoneHash(values.From);
      await this.prisma.messagingSuppression.upsert({
        where: { phoneHash },
        create: { phoneHash, reason: "Recipient opt-out", source: "twilio-inbound" },
        update: { reason: "Recipient opt-out", source: "twilio-inbound" },
      });
    }

    const providerEventId = `${sid || values.From || "unknown"}:${values.MessageStatus || inboundBody || "event"}:${values.ErrorCode || "ok"}`;
    const event = await this.prisma.messagingWebhookEvent.upsert({
      where: { providerEventId },
      create: { providerEventId, eventType: values.MessageStatus || "inbound", payload: cleanValues(values) },
      update: {},
    });
    if (event.processedAt) return { accepted: true, duplicate: true };

    if (sid && values.MessageStatus) {
      const mapped = mapTwilioStatus(values.MessageStatus);
      if (mapped) {
        await this.prisma.messageOutbox.updateMany({
          where: { providerReference: sid },
          data: {
            status: mapped,
            deliveredAt: mapped === "DELIVERED" ? new Date() : undefined,
            lastError: values.ErrorMessage || values.ErrorCode || undefined,
          },
        });
      }
    }
    await this.prisma.messagingWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { accepted: true, duplicate: false };
  }

  private async sendTemplate(to: string, templateKey: string, variables: Record<string, string>) {
    const accountSid = this.config.getOrThrow<string>("TWILIO_ACCOUNT_SID");
    const authToken = this.config.getOrThrow<string>("TWILIO_AUTH_TOKEN");
    const sender = normalizePhone(this.config.getOrThrow<string>("TWILIO_WHATSAPP_SENDER"));
    const contentSid = this.config.get<string>(`TWILIO_WHATSAPP_${templateKey.toUpperCase()}_CONTENT_SID`);
    if (!contentSid) throw new ServiceUnavailableException(`Approved Twilio template ${templateKey} is not configured`);
    const webhookUrl = this.config.getOrThrow<string>("TWILIO_WHATSAPP_WEBHOOK_URL");
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: `whatsapp:${sender}`,
        To: `whatsapp:${normalizePhone(to)}`,
        ContentSid: contentSid,
        ContentVariables: JSON.stringify(variables),
        StatusCallback: webhookUrl,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string };
    if (!response.ok || !payload.sid) throw new ServiceUnavailableException(payload.message || `Twilio returned ${response.status}`);
    return { sid: payload.sid, status: payload.status || "queued" };
  }

  private assertWorkerEnabled() {
    if (!this.pilotEnabled()) throw new ServiceUnavailableException("WhatsApp private pilot is disabled");
    if (this.config.get("TWILIO_WHATSAPP_KILL_SWITCH") !== "false") {
      throw new ServiceUnavailableException("WhatsApp kill switch is active");
    }
    if (this.config.get("NODE_ENV") === "production" && this.config.get("TWILIO_WHATSAPP_PRODUCTION_READY") !== "true") {
      throw new ServiceUnavailableException("WhatsApp production readiness has not been approved");
    }
    const sender = this.config.get<string>("TWILIO_WHATSAPP_SENDER", "");
    if (this.config.get("NODE_ENV") === "production" && normalizePhone(sender) === "+14155238886") {
      throw new ServiceUnavailableException("Twilio Sandbox sender cannot be used in production");
    }
  }

  private pilotEnabled() {
    return this.config.get("TWILIO_WHATSAPP_ENABLED") === "true";
  }

  private recipientAllowed(phone: string) {
    const allowed = this.config.get<string>("TWILIO_WHATSAPP_PILOT_ALLOWLIST", "")
      .split(",")
      .map(normalizePhone)
      .filter(Boolean);
    return allowed.includes(normalizePhone(phone));
  }

  private async assertDailyCap() {
    const cap = Math.max(Number(this.config.get("TWILIO_WHATSAPP_DAILY_SEND_CAP") || 25), 1);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const sent = await this.prisma.messageOutbox.count({
      where: { sentAt: { gte: start }, status: { in: ["SENT", "DELIVERED"] } },
    });
    if (sent >= cap) throw new ServiceUnavailableException("WhatsApp daily send cap reached");
  }

  private maxAttempts() {
    return Math.min(Math.max(Number(this.config.get("TWILIO_WHATSAPP_MAX_ATTEMPTS") || 4), 1), 10);
  }

  private phoneHash(phone: string) {
    return hashPrivateValue(normalizePhone(phone), this.config.get<string>("SESSION_HASH_SECRET", ""));
  }
}

export function normalizePhone(value: string) {
  return value.trim().replace(/^whatsapp:/i, "").replace(/[\s()-]/g, "");
}

export function verifyTwilioSignature(authToken: string, url: string, values: WebhookValues, signature: string) {
  const data = Object.keys(values).sort().reduce((result, key) => `${result}${key}${values[key] ?? ""}`, url);
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  return safeEqual(expected, signature);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanValues(values: WebhookValues) {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function mapTwilioStatus(status: string) {
  if (["delivered", "read"].includes(status)) return "DELIVERED" as const;
  if (["sent", "queued", "accepted", "scheduled"].includes(status)) return "SENT" as const;
  if (["failed", "undelivered", "canceled"].includes(status)) return "FAILED" as const;
  return null;
}
