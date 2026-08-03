import {
  BadRequestException,
  Injectable,
  type OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createHmac,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type {
  RecipientEligibility,
  WhatsAppMode,
  WhatsAppOtpStartResult,
  WhatsAppProvider,
  WhatsAppProviderStatus,
  WhatsAppSendResult,
} from "./whatsapp-provider";

const DEFAULT_SANDBOX_FROM = "whatsapp:+14155238886";
const DEFAULT_WEBHOOK_URL =
  "https://api.useloyalloop.com/api/v1/messaging/webhooks/twilio";
const E164 = /^\+[1-9]\d{7,14}$/;

type TwilioResponse = {
  code?: number;
  message?: string;
  sid?: string;
  status?: string;
};

@Injectable()
export class TwilioWhatsAppProvider
  implements WhatsAppProvider, OnModuleInit
{
  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.validateRuntimeConfiguration();
  }

  status(): WhatsAppProviderStatus {
    const whatsappMode = this.mode();
    return {
      whatsappMode,
      messagingConfigured:
        whatsappMode === "sandbox"
          ? this.sandboxConfigurationComplete()
          : this.productionConfigurationProblems().length === 0,
      otpProvider:
        whatsappMode === "sandbox" ? "internal-sandbox" : "twilio-verify",
    };
  }

  recipientEligibility(phone: string): RecipientEligibility {
    const normalized = normalizeE164(phone);
    if (this.mode() === "sandbox") {
      const joined = this.phoneList("TWILIO_WHATSAPP_SANDBOX_JOINED_NUMBERS");
      if (joined.includes(normalized)) return { allowed: true };
      return {
        allowed: false,
        reason:
          "Development WhatsApp Sandbox recipient has not joined this Sandbox. Send the Twilio Sandbox join code from that phone, then add its E.164 number to TWILIO_WHATSAPP_SANDBOX_JOINED_NUMBERS.",
      };
    }

    const allowed = this.phoneList("TWILIO_WHATSAPP_PILOT_ALLOWLIST");
    return allowed.includes(normalized)
      ? { allowed: true }
      : {
          allowed: false,
          reason: "Recipient is outside the production WhatsApp pilot allow-list",
        };
  }

  sendReceipt(phone: string, variables: Record<string, string>) {
    if (this.mode() === "sandbox") {
      const greeting = socialCopyVariant(phone, [
        `Hey ${variables["1"] || "there"} 👋 Your receipt from ${variables["2"] || "the shop"} just landed.`,
        `Quick update, ${variables["1"] || "friend"} ✨ ${variables["2"] || "the shop"} shared your receipt.`,
        `Receipt drop 🧾 ${variables["2"] || "the shop"} has confirmed your payment record.`,
      ]);
      return this.sendSandboxMessage(
        phone,
        [
          "[LOYAL LOOP DEVELOPMENT SANDBOX]",
          greeting,
          `Receipt ${variables["3"] || ""}`,
          `View the live details: ${variables["4"] || ""}`,
        ].join("\n"),
        variables["5"],
      );
    }
    return this.sendProductionReceiptTemplate(phone, variables);
  }

  sendDeliveryUpdate(phone: string, variables: Record<string, string>) {
    if (this.mode() === "sandbox") {
      const update = socialCopyVariant(`${phone}:${variables["4"]}`, [
        `Hey ${variables["1"] || "there"} 👋 ${variables["2"] || "your shop"} moved ${variables["3"] || "your order"} to ${variables["4"] || "the next step"}.`,
        `Psst, order update 📦 ${variables["3"] || "Your order"} is now ${variables["4"] || "updated"}.`,
        `${variables["2"] || "Your shop"} just checked in ✨ ${variables["3"] || "Your order"} is ${variables["4"] || "moving along"}.`,
      ]);
      return this.sendSandboxMessage(
        phone,
        [
          "[LOYAL LOOP DEVELOPMENT SANDBOX]",
          update,
          `Stay with the journey: ${variables["5"] || ""}`,
        ].join("\n"),
      );
    }
    return this.sendProductionTemplate(phone, "delivery", variables);
  }

  sendOrderUpdate(phone: string, variables: Record<string, string>) {
    if (this.mode() === "sandbox") {
      const update = socialCopyVariant(`${phone}:${variables["4"]}`, [
        `Hey ${variables["1"] || "there"} 👋 We let ${variables["2"] || "the shop"} know about ${variables["3"] || "your request"}.`,
        `Psst, ${variables["2"] || "the shop"} has an order update for you 📦`,
        `Quick Loyal Loop check-in ✨ ${variables["3"] || "Your request"} has moved forward.`,
      ]);
      return this.sendSandboxMessage(phone, [
        "[LOYAL LOOP DEVELOPMENT SANDBOX]",
        update,
        variables["4"] || "The shop is reviewing your request.",
        `Follow it here: ${variables["5"] || ""}`,
      ].join("\n"));
    }
    return this.sendProductionTemplate(phone, "delivery", variables);
  }

  sendReminder(phone: string, variables: Record<string, string>) {
    if (this.mode() === "sandbox") {
      return this.sendSandboxMessage(
        phone,
        [
          "[LOYAL LOOP DEVELOPMENT SANDBOX]",
          `Hey ${variables["1"] || "there"} 👋 ${variables["2"] || "a shop you know"} left you a quick reminder:`,
          variables["3"] || "You have a reminder from Loyal Loop.",
        ].join("\n"),
      );
    }
    return this.sendProductionTemplate(phone, "reminder", variables);
  }

  sendFoundingAccess(phone: string, variables: Record<string, string>) {
    if (this.mode() === "sandbox") {
      return this.sendSandboxMessage(
        phone,
        [
          "[LOYAL LOOP DEVELOPMENT SANDBOX]",
          `Hi ${variables["1"] || "there"} 👋`,
          `${variables["2"] || "Your business"} has been invited to the Loyal Loop Founding Circle.`,
          `Start before ${variables["4"] || "the invitation expires"}: ${variables["3"] || ""}`,
        ].join("\n"),
      );
    }
    return this.sendProductionTemplate(phone, "founding_access", variables);
  }

  sendOwnerDigest(phone: string, variables: Record<string, string>) {
    if (this.mode() === "sandbox") {
      return this.sendSandboxMessage(
        phone,
        [
          "[LOYAL LOOP DEVELOPMENT SANDBOX]",
          `Good morning, ${variables["1"] || "there"}.`,
          variables["3"] || "Your business checklist is ready.",
          variables["4"] || "Open Loyal Loop to review today's work.",
        ].join("\n"),
      );
    }
    return this.sendProductionTemplate(phone, "owner_digest", variables);
  }

  async sendOtp(phone: string): Promise<WhatsAppOtpStartResult> {
    const normalized = normalizeE164(phone);
    this.assertOtpEnabled();
    this.assertRecipientEligible(normalized);

    if (this.mode() === "production") {
      const result = await this.verifyRequest("Verifications", {
        To: normalized,
        Channel: "whatsapp",
      });
      return {
        provider: "twilio-verify",
        reference: this.requiredResponseSid(result),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      };
    }

    this.assertSandboxOtpIsSafe();
    const secret = this.config.get<string>("SESSION_HASH_SECRET");
    if (!secret) {
      throw new ServiceUnavailableException(
        "Sandbox OTP requires SESSION_HASH_SECRET",
      );
    }
    const code = String(randomInt(100000, 1000000));
    const salt = randomUUID();
    const digest = otpDigest(secret, salt, normalized, code);
    await this.sendSandboxTransport(
      normalized,
      [
        "[LOYAL LOOP DEVELOPMENT SANDBOX]",
        `🔐 Your Loyal Loop security code is ${code}.`,
        "It expires in 10 minutes. Never share this code—not even with someone claiming to be Loyal Loop. We will never ask you for it.",
      ].join("\n"),
    );
    return {
      provider: "internal-sandbox",
      reference: `sandbox:${salt}:${digest}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  }

  async verifyOtp(reference: string, phone: string, code: string) {
    const normalized = normalizeE164(phone);
    if (this.mode() === "production") {
      if (!reference || reference.startsWith("sandbox:")) return false;
      const result = await this.verifyRequest("VerificationCheck", {
        To: normalized,
        Code: code,
      });
      return result.status === "approved";
    }

    this.assertSandboxOtpIsSafe();
    const [prefix, salt, storedDigest, ...extra] = reference.split(":");
    const secret = this.config.get<string>("SESSION_HASH_SECRET");
    if (
      prefix !== "sandbox" ||
      !salt ||
      !storedDigest ||
      extra.length ||
      !secret
    ) {
      return false;
    }
    const candidate = otpDigest(secret, salt, normalized, code);
    return safeEqual(candidate, storedDigest);
  }

  sendMessage(phone: string, body: string) {
    if (this.mode() === "sandbox") {
      return this.sendSandboxMessage(phone, body);
    }
    this.assertMessagingEnabled();
    this.assertRecipientEligible(phone);
    return this.sendTwilioMessage({
      From: channelAddress(
        this.config.getOrThrow<string>("TWILIO_WHATSAPP_SENDER"),
      ),
      MessagingServiceSid: this.config.getOrThrow<string>(
        "TWILIO_MESSAGING_SERVICE_SID",
      ),
      To: channelAddress(phone),
      Body: body,
      StatusCallback: this.webhookUrl(),
    });
  }

  private async sendSandboxMessage(phone: string, body: string, mediaUrl?: string) {
    this.assertMessagingEnabled();
    this.assertRecipientEligible(phone);
    return this.sendSandboxTransport(phone, body, mediaUrl);
  }

  private async sendSandboxTransport(phone: string, body: string, mediaUrl?: string) {
    return this.sendTwilioMessage({
      From: channelAddress(
        this.config.get<string>(
          "TWILIO_WHATSAPP_SANDBOX_FROM",
          DEFAULT_SANDBOX_FROM,
        ),
      ),
      To: channelAddress(phone),
      Body: body,
      ...(mediaUrl ? { MediaUrl: mediaUrl } : {}),
      StatusCallback: this.webhookUrl(),
    });
  }

  private sendProductionTemplate(
    phone: string,
    template: "receipt" | "delivery" | "reminder" | "founding_access" | "owner_digest",
    variables: Record<string, string>,
  ) {
    this.assertMessagingEnabled();
    this.assertRecipientEligible(phone);
    return this.sendTwilioMessage({
      From: channelAddress(
        this.config.getOrThrow<string>("TWILIO_WHATSAPP_SENDER"),
      ),
      MessagingServiceSid: this.config.getOrThrow<string>(
        "TWILIO_MESSAGING_SERVICE_SID",
      ),
      To: channelAddress(phone),
      ContentSid: this.contentSid(template),
      ContentVariables: JSON.stringify(variables),
      StatusCallback: this.webhookUrl(),
    });
  }

  private sendProductionReceiptTemplate(phone: string, variables: Record<string, string>) {
    this.assertMessagingEnabled();
    this.assertRecipientEligible(phone);
    const contentSid = this.config.get<string>("TWILIO_RECEIPT_MEDIA_CONTENT_SID") || this.config.get<string>("TWILIO_WHATSAPP_RECEIPT_MEDIA_CONTENT_SID");
    if (!contentSid) throw new ServiceUnavailableException("Approved receipt media WhatsApp Content Template is not configured");
    return this.sendTwilioMessage({
      From: channelAddress(this.config.getOrThrow<string>("TWILIO_WHATSAPP_SENDER")),
      MessagingServiceSid: this.config.getOrThrow<string>("TWILIO_MESSAGING_SERVICE_SID"),
      To: channelAddress(phone),
      ContentSid: contentSid,
      ContentVariables: JSON.stringify(variables),
      StatusCallback: this.webhookUrl(),
    });
  }

  private async sendTwilioMessage(values: Record<string, string>) {
    const accountSid = this.config.get<string>("TWILIO_ACCOUNT_SID");
    const authToken = this.config.get<string>("TWILIO_AUTH_TOKEN");
    if (!accountSid || !authToken) {
      throw new ServiceUnavailableException(
        "Twilio WhatsApp credentials are not configured",
      );
    }
    let response: Response;
    try {
      response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            authorization: basicAuth(accountSid, authToken),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams(values),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        `${this.mode() === "sandbox" ? "Development WhatsApp Sandbox" : "Twilio WhatsApp"} is temporarily unreachable`,
      );
    }
    const result = (await response.json().catch(() => ({}))) as TwilioResponse;
    if (!response.ok || !result.sid) {
      throw new ServiceUnavailableException(twilioFailureMessage(result, response.status));
    }
    return {
      sid: result.sid,
      status: result.status || "queued",
      provider:
        this.mode() === "sandbox"
          ? "twilio-whatsapp-sandbox"
          : "twilio-whatsapp-production",
    } satisfies WhatsAppSendResult;
  }

  private async verifyRequest(
    resource: "Verifications" | "VerificationCheck",
    values: Record<string, string>,
  ) {
    const accountSid = this.config.getOrThrow<string>("TWILIO_ACCOUNT_SID");
    const authToken = this.config.getOrThrow<string>("TWILIO_AUTH_TOKEN");
    const serviceSid = this.config.getOrThrow<string>(
      "TWILIO_VERIFY_SERVICE_SID",
    );
    const response = await fetch(
      `https://verify.twilio.com/v2/Services/${serviceSid}/${resource}`,
      {
        method: "POST",
        headers: {
          authorization: basicAuth(accountSid, authToken),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(values),
      },
    );
    const result = (await response.json().catch(() => ({}))) as TwilioResponse;
    if (!response.ok) {
      throw new ServiceUnavailableException(
        result.message || "Twilio Verify WhatsApp request failed",
      );
    }
    return result;
  }

  private assertOtpEnabled() {
    if (this.config.get("TWILIO_WHATSAPP_VERIFY_ENABLED") !== "true") {
      throw new ServiceUnavailableException("WhatsApp verification is disabled");
    }
    this.assertKillSwitchAndProductionReadiness();
    if (!this.status().messagingConfigured) {
      throw new ServiceUnavailableException(
        `${this.mode() === "sandbox" ? "Sandbox" : "Production"} WhatsApp is not fully configured`,
      );
    }
  }

  private assertMessagingEnabled() {
    if (this.config.get("TWILIO_WHATSAPP_ENABLED") !== "true") {
      throw new ServiceUnavailableException("WhatsApp messaging is disabled");
    }
    this.assertKillSwitchAndProductionReadiness();
    if (!this.status().messagingConfigured) {
      throw new ServiceUnavailableException(
        `${this.mode() === "sandbox" ? "Sandbox" : "Production"} WhatsApp is not fully configured`,
      );
    }
  }

  private assertKillSwitchAndProductionReadiness() {
    if (this.config.get("TWILIO_WHATSAPP_KILL_SWITCH") !== "false") {
      throw new ServiceUnavailableException("WhatsApp kill switch is active");
    }
    if (
      this.mode() === "production" &&
      this.config.get("NODE_ENV") === "production" &&
      this.config.get("TWILIO_WHATSAPP_PRODUCTION_READY") !== "true"
    ) {
      throw new ServiceUnavailableException(
        "WhatsApp production readiness has not been approved",
      );
    }
  }

  private assertRecipientEligible(phone: string) {
    const eligibility = this.recipientEligibility(phone);
    if (!eligibility.allowed) {
      throw new ServiceUnavailableException(eligibility.reason);
    }
  }

  private assertSandboxOtpIsSafe() {
    if (this.mode() !== "sandbox" || !this.sandboxRuntimeIsAllowed()) {
      throw new ServiceUnavailableException(
        "Internal Sandbox OTP is development-only",
      );
    }
    const databaseUrl = this.config.get<string>("DATABASE_URL", "");
    const explicitlyIsolated =
      this.config.get<string>("DATABASE_SAFETY_MODE") === "isolated";
    const explicitlyDeployed =
      this.config.get("NODE_ENV") === "production" &&
      this.deployedSandboxOverrideEnabled();
    if (
      !isLocalDatabaseUrl(databaseUrl) &&
      !explicitlyIsolated &&
      !explicitlyDeployed
    ) {
      throw new ServiceUnavailableException(
        "Internal Sandbox OTP requires a local/isolated database or the explicit deployed-Sandbox override",
      );
    }
  }

  private validateRuntimeConfiguration() {
    const mode = this.mode();
    if (mode === "sandbox") {
      if (
        this.config.get("NODE_ENV") === "production" &&
        this.config.get("TWILIO_WHATSAPP_ALLOW_DEPLOYED_SANDBOX") !== "true"
      ) {
        throw new Error(
          "TWILIO_WHATSAPP_MODE=sandbox is development-only; a production-built staging runtime must explicitly set TWILIO_WHATSAPP_ALLOW_DEPLOYED_SANDBOX=true",
        );
      }
      this.validateConfiguredPhone(
        "TWILIO_WHATSAPP_SANDBOX_FROM",
        this.config.get<string>(
          "TWILIO_WHATSAPP_SANDBOX_FROM",
          DEFAULT_SANDBOX_FROM,
        ),
      );
      this.validatePhoneList("TWILIO_WHATSAPP_SANDBOX_JOINED_NUMBERS");
      return;
    }

    const problems = this.productionConfigurationProblems();
    if (problems.length) {
      throw new Error(
        `Twilio WhatsApp production mode configuration error: ${problems.join(", ")}`,
      );
    }
    this.validateConfiguredPhone(
      "TWILIO_WHATSAPP_SENDER",
      this.config.get<string>("TWILIO_WHATSAPP_SENDER", ""),
    );
    this.validatePhoneList("TWILIO_WHATSAPP_PILOT_ALLOWLIST");
  }

  private sandboxRuntimeIsAllowed() {
    return (
      this.config.get("NODE_ENV") !== "production" ||
      this.deployedSandboxOverrideEnabled()
    );
  }

  private deployedSandboxOverrideEnabled() {
    return (
      this.config.get("TWILIO_WHATSAPP_ALLOW_DEPLOYED_SANDBOX") === "true"
    );
  }

  private mode(): WhatsAppMode {
    const value = this.config.get<string>("TWILIO_WHATSAPP_MODE")?.trim();
    if (!value) {
      if (this.config.get("NODE_ENV") === "production") {
        throw new Error(
          "TWILIO_WHATSAPP_MODE must be explicitly set to production in a production runtime",
        );
      }
      return "sandbox";
    }
    if (value !== "sandbox" && value !== "production") {
      throw new Error(
        "TWILIO_WHATSAPP_MODE must be either sandbox or production",
      );
    }
    return value;
  }

  private sandboxConfigurationComplete() {
    return Boolean(
      this.config.get("TWILIO_ACCOUNT_SID") &&
        this.config.get("TWILIO_AUTH_TOKEN") &&
        this.config.get(
          "TWILIO_WHATSAPP_SANDBOX_FROM",
          DEFAULT_SANDBOX_FROM,
        ) &&
        this.webhookUrl() &&
        this.phoneList("TWILIO_WHATSAPP_SANDBOX_JOINED_NUMBERS").length,
    );
  }

  private productionConfigurationProblems() {
    const required = [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_WHATSAPP_SENDER",
      "TWILIO_MESSAGING_SERVICE_SID",
      "TWILIO_VERIFY_SERVICE_SID",
      "TWILIO_WHATSAPP_WEBHOOK_URL",
    ];
    const problems = required
      .filter((key) => !this.config.get<string>(key))
      .map((key) => `missing ${key}`);
    const receiptMediaSid = this.config.get<string>("TWILIO_RECEIPT_MEDIA_CONTENT_SID") || this.config.get<string>("TWILIO_WHATSAPP_RECEIPT_MEDIA_CONTENT_SID");
    if (!receiptMediaSid) problems.push("missing TWILIO_RECEIPT_MEDIA_CONTENT_SID");
    for (const template of ["delivery", "reminder", "founding_access"] as const) {
      if (!this.optionalContentSid(template)) {
        problems.push(`missing ${contentSidEnvironmentName(template)}`);
      }
    }
    const prefixChecks: Array<[string, string | undefined, RegExp]> = [
      ["TWILIO_ACCOUNT_SID", this.config.get("TWILIO_ACCOUNT_SID"), /^AC[0-9a-fA-F]{32}$/],
      ["TWILIO_MESSAGING_SERVICE_SID", this.config.get("TWILIO_MESSAGING_SERVICE_SID"), /^MG[0-9a-fA-F]{32}$/],
      ["TWILIO_VERIFY_SERVICE_SID", this.config.get("TWILIO_VERIFY_SERVICE_SID"), /^VA[0-9a-fA-F]{32}$/],
    ];
    for (const [key, value, pattern] of prefixChecks) {
      if (value && !pattern.test(value)) problems.push(`invalid ${key}`);
    }
    if (receiptMediaSid && !/^HX[0-9a-fA-F]{32}$/.test(receiptMediaSid)) problems.push("invalid TWILIO_RECEIPT_MEDIA_CONTENT_SID");
    for (const template of ["delivery", "reminder", "founding_access"] as const) {
      const value = this.optionalContentSid(template);
      if (value && !/^HX[0-9a-fA-F]{32}$/.test(value)) {
        problems.push(`invalid ${contentSidEnvironmentName(template)}`);
      }
    }
    const webhook = this.config.get<string>("TWILIO_WHATSAPP_WEBHOOK_URL");
    if (webhook && !webhook.startsWith("https://")) {
      problems.push("TWILIO_WHATSAPP_WEBHOOK_URL must use HTTPS");
    }
    return problems;
  }

  private contentSid(template: "receipt" | "delivery" | "reminder" | "founding_access" | "owner_digest") {
    const value = this.optionalContentSid(template);
    if (!value) {
      throw new ServiceUnavailableException(
        `Approved ${template} WhatsApp Content Template is not configured`,
      );
    }
    return value;
  }

  private optionalContentSid(
    template: "receipt" | "delivery" | "reminder" | "founding_access" | "owner_digest",
  ) {
    return (
      this.config.get<string>(contentSidEnvironmentName(template)) ||
      this.config.get<string>(
        `TWILIO_WHATSAPP_${template.toUpperCase()}_CONTENT_SID`,
      )
    );
  }

  private webhookUrl() {
    return this.config.get<string>(
      "TWILIO_WHATSAPP_WEBHOOK_URL",
      DEFAULT_WEBHOOK_URL,
    );
  }

  private phoneList(key: string) {
    return this.config
      .get<string>(key, "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .map(normalizeE164);
  }

  private validatePhoneList(key: string) {
    try {
      this.phoneList(key);
    } catch {
      throw new Error(`${key} contains a phone number that is not E.164`);
    }
  }

  private validateConfiguredPhone(key: string, value: string) {
    try {
      normalizeE164(value);
    } catch {
      throw new Error(`${key} must contain an E.164 WhatsApp phone number`);
    }
  }

  private requiredResponseSid(response: TwilioResponse) {
    if (!response.sid) {
      throw new ServiceUnavailableException(
        "Twilio Verify did not return a verification reference",
      );
    }
    return response.sid;
  }
}

export function normalizeE164(value: string) {
  const withoutChannel = value.trim().replace(/^whatsapp:/i, "").trim();
  const digits = withoutChannel.replace(/\D/g, "");
  const normalized = digits ? `+${digits}` : "";
  if (!E164.test(normalized)) {
    throw new BadRequestException("Phone number must use E.164 format");
  }
  return normalized;
}

function channelAddress(value: string) {
  return `whatsapp:${normalizeE164(value)}`;
}

function contentSidEnvironmentName(
  template: "receipt" | "delivery" | "reminder" | "founding_access" | "owner_digest",
) {
  return `TWILIO_${template.toUpperCase()}_CONTENT_SID`;
}

function otpDigest(
  secret: string,
  salt: string,
  phone: string,
  code: string,
) {
  return createHmac("sha256", secret)
    .update(`${salt}:${phone}:${code}`)
    .digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function socialCopyVariant(seed: string, variants: string[]) {
  const score = [...seed].reduce((total, character) => total + character.charCodeAt(0), 0);
  return variants[score % variants.length] || variants[0] || "Loyal Loop update";
}

function basicAuth(accountSid: string, authToken: string) {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

function twilioFailureMessage(result: TwilioResponse, status: number) {
  if (result.code === 63015) {
    return "Development WhatsApp Sandbox recipient has not joined this Sandbox. Send the Sandbox join code from the recipient phone and try again.";
  }
  if (result.code === 63016) {
    return "The WhatsApp Sandbox conversation window is closed. Rejoin or message the Sandbox from the recipient phone, then try again.";
  }
  if (result.code === 63007) {
    return "The Twilio WhatsApp Sandbox is not activated for this account.";
  }
  return result.message || `Twilio WhatsApp returned ${status}`;
}

function isLocalDatabaseUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}
