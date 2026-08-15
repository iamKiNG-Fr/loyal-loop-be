import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createDecipheriv,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { createOpaqueToken, hashPrivateValue } from "../../common/crypto.util";
import { receiptMediaSignature } from "../../common/receipt-media.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { PrismaService } from "../prisma/prisma.service";
import { normalizeE164 } from "./twilio-whatsapp.provider";
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from "./whatsapp-provider";

type UtilityPurpose = "RECEIPT" | "DELIVERY" | "REMINDER" | "FOUNDING_ACCESS" | "OWNER_DIGEST";
type WebhookValues = Record<string, string | undefined>;

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(WHATSAPP_PROVIDER)
    private readonly whatsapp: WhatsAppProvider,
  ) {}

  status() {
    return this.whatsapp.status();
  }

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
    await this.grantPhoneConsent(
      account.phone,
      purpose,
      "customer-settings",
      customerAccountId,
    );
    return this.consentState(customerAccountId);
  }

  async grantPhoneConsent(
    phone: string,
    purpose: UtilityPurpose,
    source: string,
    customerAccountId?: string,
    userId?: string,
  ) {
    const normalizedPhone = normalizePhone(phone);
    const phoneHash = this.phoneHash(normalizedPhone);
    await this.prisma.messagingConsent.upsert({
      where: { phoneHash_purpose: { phoneHash, purpose } },
      create: {
        customerAccountId,
        userId,
        phoneHash,
        purpose,
        source,
      },
      update: {
        customerAccountId,
        userId,
        source,
        grantedAt: new Date(),
        revokedAt: null,
      },
    });
  }

  async revokePhoneConsent(phone: string, purpose: UtilityPurpose, source: string) {
    const normalizedPhone = normalizePhone(phone);
    await this.prisma.messagingConsent.updateMany({
      where: {
        phoneHash: this.phoneHash(normalizedPhone),
        purpose,
        revokedAt: null,
      },
      data: { revokedAt: new Date(), source },
    });
  }

  async grantFoundingAccessConsent(phone: string, source: string) {
    await this.grantPhoneConsent(phone, "FOUNDING_ACCESS", source);
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
    recipientUserId?: string;
    businessId?: string;
    phone: string;
    purpose: UtilityPurpose;
    templateKey: string;
    variables: Record<string, string>;
    idempotencyKey: string;
    awaitDelivery?: boolean;
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
        recipientUserId: input.recipientUserId,
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

    // Founding invitations are linked to their outbox record immediately after
    // enqueueing. Do not race that link: the caller explicitly starts delivery
    // once the invitation can supply the one-time encrypted token.
    let status = record.status;
    if (
      record.status === "PENDING" &&
      input.templateKey !== "founding_access" &&
      this.pilotEnabled()
    ) {
      if (input.awaitDelivery) status = await this.processOne(record.id);
      else void this.processOne(record.id).catch(() => undefined);
    }
    return { id: record.id, status };
  }

  async enqueueFoundingAccess(input: {
    invitationId: string;
    phone: string;
    recipientName: string;
    businessName: string;
    expiresAt: Date;
  }) {
    return this.enqueueUtility({
      phone: input.phone,
      purpose: "FOUNDING_ACCESS",
      templateKey: "founding_access",
      variables: {
        "1": input.recipientName,
        "2": input.businessName,
        "4": input.expiresAt.toLocaleDateString("en-NG"),
        invitationId: input.invitationId,
      },
      idempotencyKey: `founding-access:${input.invitationId}`,
    });
  }

  startFoundingAccessDelivery(outboxId: string) {
    if (this.pilotEnabled()) {
      void this.processOne(outboxId).catch(() => undefined);
    }
  }

  async enqueueReceipt(auth: OwnerAuthContext, receiptId: string, options: { awaitDelivery?: boolean } = {}) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { id: receiptId, businessId: auth.businessId, status: { not: "VOID" } },
      include: { business: true, customer: true },
    });
    if (!receipt || !receipt.customer.phone) throw new BadRequestException("Receipt customer needs a WhatsApp phone number");
    const generated = createOpaqueToken();
    await this.prisma.receiptShareToken.create({ data: { receiptId, tokenHash: generated.tokenHash } });
    const appUrl = this.config.get<string>("APP_URL", "https://www.useloyalloop.com").replace(/\/$/, "");
    const mediaSecret = this.config.get<string>("RECEIPT_MEDIA_SIGNING_SECRET") || this.config.get<string>("SESSION_HASH_SECRET");
    if (!mediaSecret) throw new ServiceUnavailableException("Receipt media signing is not configured");
    const mediaExpires = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
    const mediaSignature = receiptMediaSignature(mediaSecret, receipt.id, mediaExpires);
    const receiptImageUrl = `${appUrl}/og/receipt-message/${encodeURIComponent(receipt.id)}.png?expires=${mediaExpires}&signature=${mediaSignature}`;
    const delivery = await this.enqueueUtility({
      awaitDelivery: options.awaitDelivery,
      businessId: auth.businessId,
      customerAccountId: receipt.customer.accountId ?? undefined,
      phone: receipt.customer.phone,
      purpose: "RECEIPT",
      templateKey: "receipt",
      variables: { "1": receipt.customer.name, "2": receipt.business.name, "3": receipt.receiptCode, "4": `${appUrl}/receipt/${generated.token}`, "5": receiptImageUrl },
      idempotencyKey: `receipt:${receipt.id}:${receipt.updatedAt.getTime()}`,
    });
    if (["PENDING", "SENT", "DELIVERED"].includes(delivery.status)) {
      await this.prisma.receipt.update({
        where: { id: receiptId },
        data: { status: receipt.status === "CREATED" ? "SENT" : undefined, sentAt: receipt.sentAt ?? new Date() },
      });
    }
    return { ...delivery, imageAttached: true, receiptId: receipt.id };
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

  async enqueueOrderRequestStatus(orderRequestId: string, existingToken?: string) {
    const request = await this.prisma.orderRequest.findUnique({
      where: { id: orderRequestId },
      include: { business: true },
    });
    if (!request) throw new BadRequestException("Order request is not available");
    const generated = existingToken ? null : createOpaqueToken();
    if (generated) {
      await this.prisma.orderRequestShareToken.create({
        data: { orderRequestId: request.id, tokenHash: generated.tokenHash },
      });
    }
    const token = existingToken || generated!.token;
    const appUrl = this.config.get<string>("APP_URL", "https://www.useloyalloop.com").replace(/\/$/, "");
    return this.enqueueUtility({
      businessId: request.businessId,
      customerAccountId: request.customerAccountId ?? undefined,
      phone: request.customerPhone,
      purpose: "DELIVERY",
      templateKey: "order_request",
      variables: {
        "1": request.customerName,
        "2": request.business.name,
        "3": request.referenceCode,
        "4": orderRequestMessage(request.status, request.cancellationReason),
        "5": `${appUrl}/request/${token}`,
      },
      idempotencyKey: `order-request:${request.id}:${request.updatedAt.getTime()}`,
    });
  }

  async enqueueReminder(auth: OwnerAuthContext, suggestionId: string) {
    const suggestion = await this.prisma.followUpSuggestion.findFirst({
      where: { id: suggestionId, businessId: auth.businessId },
      include: { business: true, customer: true, template: true },
    });
    if (!suggestion || !suggestion.customer.phone) {
      throw new BadRequestException(
        "Approved reminder needs a customer WhatsApp phone number",
      );
    }
    if (suggestion.status !== "APPROVED") {
      throw new BadRequestException(
        "Approve this follow-up before sending its WhatsApp reminder",
      );
    }
    const reminder = (suggestion.template?.body || suggestion.reason)
      .trim()
      .slice(0, 1000);
    return this.enqueueUtility({
      businessId: auth.businessId,
      customerAccountId: suggestion.customer.accountId ?? undefined,
      phone: suggestion.customer.phone,
      purpose: "REMINDER",
      templateKey: "reminder",
      variables: {
        "1": suggestion.customer.name,
        "2": suggestion.business.name,
        "3": reminder,
      },
      idempotencyKey: `reminder:${suggestion.id}:${suggestion.updatedAt.getTime()}`,
    });
  }

  async enqueueProductLaunch(input: {
    businessId: string;
    businessName: string;
    customerAccountId: string;
    customerName?: string | null;
    phone: string;
    productId: string;
    productName: string;
    launchAt: Date;
    url: string;
  }) {
    return this.enqueueUtility({
      businessId: input.businessId,
      customerAccountId: input.customerAccountId,
      phone: input.phone,
      purpose: "REMINDER",
      templateKey: "reminder",
      variables: {
        "1": input.customerName?.trim() || "there",
        "2": input.businessName,
        "3": `${input.productName} just dropped 🎉 Open it here: ${input.url}`,
      },
      idempotencyKey: `product-launch:${input.productId}:${input.launchAt.getTime()}:${input.customerAccountId}`,
    });
  }

  async enqueueOwnerDigest(input: {
    businessId: string;
    userId: string;
    phone: string;
    ownerName: string;
    businessName: string;
    summary: string;
    url: string;
    businessDate: string;
  }) {
    return this.enqueueUtility({
      businessId: input.businessId,
      recipientUserId: input.userId,
      phone: input.phone,
      purpose: "OWNER_DIGEST",
      templateKey: "owner_digest",
      variables: {
        "1": input.ownerName,
        "2": input.businessName,
        "3": input.summary,
        "4": input.url,
      },
      idempotencyKey: `owner-digest:${input.businessId}:${input.userId}:${input.businessDate}`,
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
    const eligibility = this.whatsapp.recipientEligibility(outbox.toAddress);
    if (!eligibility.allowed) {
      await this.prisma.$transaction([
        this.prisma.messageOutbox.update({
          where: { id },
          data: {
            status: "SUPPRESSED",
            lastError: eligibility.reason || "WhatsApp recipient is not eligible",
          },
        }),
        ...(outbox.templateKey === "founding_access"
          ? [this.prisma.onboardingInvitation.updateMany({
              where: { messageOutboxId: outbox.id },
              data: { encryptedToken: null },
            })]
          : []),
      ]);
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
      await this.prisma.$transaction([
        this.prisma.messageOutbox.update({
          where: { id },
          data: { status: "SUPPRESSED", lastError: "Consent missing, revoked, or recipient suppressed" },
        }),
        ...(outbox.templateKey === "founding_access"
          ? [this.prisma.onboardingInvitation.updateMany({
              where: { messageOutboxId: outbox.id },
              data: { encryptedToken: null },
            })]
          : []),
      ]);
      return "SUPPRESSED";
    }
    await this.assertDailyCap();
    await this.prisma.messageOutbox.update({ where: { id }, data: { status: "PROCESSING" } });

    try {
      const variables = await this.messageVariables(outbox);
      const result = await this.sendWithProvider(
        outbox.toAddress,
        outbox.templateKey,
        variables,
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
            provider: result.provider,
            providerReference: result.sid,
            status: "SENT",
            metadata: {
              twilioStatus: result.status,
              whatsappMode: this.whatsapp.status().whatsappMode,
            },
          },
        }),
        ...(outbox.templateKey === "founding_access"
          ? [
              this.prisma.onboardingInvitation.updateMany({
                where: { messageOutboxId: outbox.id },
                data: { encryptedToken: null },
              }),
            ]
          : []),
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
            provider: `twilio-whatsapp-${this.whatsapp.status().whatsappMode}`,
            status: terminal ? "DEAD_LETTER" : "FAILED",
            error: message.slice(0, 500),
          },
        }),
        ...(terminal && outbox.templateKey === "founding_access"
          ? [
              this.prisma.onboardingInvitation.updateMany({
                where: { messageOutboxId: outbox.id },
                data: { encryptedToken: null },
              }),
            ]
          : []),
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
            lastError: webhookErrorMessage(values),
          },
        });
      }
    }
    await this.prisma.messagingWebhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
    return { accepted: true, duplicate: false };
  }

  private sendWithProvider(
    to: string,
    templateKey: string,
    variables: Record<string, string>,
  ) {
    if (templateKey === "receipt") {
      return this.whatsapp.sendReceipt(to, variables);
    }
    if (templateKey === "delivery") {
      return this.whatsapp.sendDeliveryUpdate(to, variables);
    }
    if (templateKey === "order_request") {
      return this.whatsapp.sendOrderUpdate(to, variables);
    }
    if (templateKey === "reminder") {
      return this.whatsapp.sendReminder(to, variables);
    }
    if (templateKey === "founding_access") {
      return this.whatsapp.sendFoundingAccess(to, variables);
    }
    if (templateKey === "owner_digest") {
      return this.whatsapp.sendOwnerDigest(to, variables);
    }
    throw new ServiceUnavailableException(
      `Unsupported WhatsApp message template: ${templateKey}`,
    );
  }

  private async messageVariables(outbox: {
    id: string;
    templateKey: string;
    payload: unknown;
  }) {
    const variables = { ...(outbox.payload as Record<string, string>) };
    if (outbox.templateKey !== "founding_access") return variables;
    const invitation = await this.prisma.onboardingInvitation.findFirst({
      where: { messageOutboxId: outbox.id },
      select: { encryptedToken: true },
    });
    if (!invitation?.encryptedToken) {
      throw new ServiceUnavailableException("Founding invitation delivery token is unavailable");
    }
    const code = this.decryptFoundingToken(invitation.encryptedToken);
    const appUrl = this.config
      .get<string>("APP_URL", "https://www.useloyalloop.com")
      .replace(/\/$/, "");
    variables["3"] = `${appUrl}/join#invite=${encodeURIComponent(code)}`;
    delete variables.invitationId;
    return variables;
  }

  private decryptFoundingToken(value: string) {
    const parts = value.split(".");
    if (parts.length !== 3) throw new ServiceUnavailableException("Invitation token is invalid");
    const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, "base64url"));
    const secret =
      this.config.get<string>("FOUNDING_INVITATION_ENCRYPTION_KEY") ||
      this.config.get<string>("FOUNDING_GRANT_SECRET") ||
      this.config.get<string>("SESSION_HASH_SECRET");
    if (!secret) throw new ServiceUnavailableException("Invitation encryption is not configured");
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  private assertWorkerEnabled() {
    if (!this.pilotEnabled()) throw new ServiceUnavailableException("WhatsApp private pilot is disabled");
    if (this.config.get("TWILIO_WHATSAPP_KILL_SWITCH") !== "false") {
      throw new ServiceUnavailableException("WhatsApp kill switch is active");
    }
    if (
      this.whatsapp.status().whatsappMode === "production" &&
      this.config.get("NODE_ENV") === "production" &&
      this.config.get("TWILIO_WHATSAPP_PRODUCTION_READY") !== "true"
    ) {
      throw new ServiceUnavailableException("WhatsApp production readiness has not been approved");
    }
  }

  private pilotEnabled() {
    return this.config.get("TWILIO_WHATSAPP_ENABLED") === "true";
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
  return normalizeE164(value);
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

function orderRequestMessage(status: string, cancellationReason: string | null) {
  if (status === "CANCELED") return cancellationReason || "This request could not go ahead this time";
  if (status === "NEEDS_CHANGES") return "One quick thing: the shop needs a detail from you before confirming";
  if (status === "ACCEPTED") return "Good news—the shop accepted your request and is checking the final details";
  if (status === "CONVERTED") return "You’re all set—your confirmed order journey is ready ✨";
  return "Request received. The shop is taking a look and will confirm the details before you pay";
}

function webhookErrorMessage(values: WebhookValues) {
  if (values.ErrorCode === "63015") {
    return "Development WhatsApp Sandbox recipient has not joined this Sandbox";
  }
  if (values.ErrorCode === "63016") {
    return "WhatsApp Sandbox conversation window is closed; the test phone must message or rejoin the Sandbox";
  }
  return values.ErrorMessage || values.ErrorCode || undefined;
}
