import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomInt, randomUUID } from "node:crypto";
import type { OtpProvider, OtpStartResult } from "./otp-provider";

type TwilioVerification = {
  sid: string;
  status: string;
};

export class TwilioVerifyProvider implements OtpProvider {
  constructor(private readonly config: ConfigService) {}

  async start(phone: string): Promise<OtpStartResult> {
    if (this.useDevelopmentOtp()) {
      return this.startDevelopmentChallenge();
    }

    if (!this.isConfigured()) {
      if (this.config.get("NODE_ENV") === "production") {
        throw new ServiceUnavailableException("WhatsApp verification is not configured");
      }
      return this.startDevelopmentChallenge();
    }

    this.assertPilotAllowed(phone);

    const result = await this.request<TwilioVerification>("Verifications", {
      To: phone,
      Channel: "whatsapp",
    });
    return {
      provider: "twilio-verify",
      reference: result.sid,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  }

  async verify(reference: string, phone: string, code: string) {
    if (reference.startsWith("dev:")) {
      this.assertDevelopmentOtpIsSafe();
      return reference.split(":")[2] === code;
    }
    const result = await this.request<TwilioVerification>(
      "VerificationCheck",
      { To: phone, Code: code },
    );
    return result.status === "approved";
  }

  private isConfigured() {
    return Boolean(
      this.config.get("TWILIO_ACCOUNT_SID") &&
        this.config.get("TWILIO_AUTH_TOKEN") &&
        this.config.get("TWILIO_VERIFY_SERVICE_SID"),
    );
  }

  private assertPilotAllowed(phone: string) {
    if (this.config.get("TWILIO_WHATSAPP_VERIFY_ENABLED") !== "true") {
      throw new ServiceUnavailableException("WhatsApp verification pilot is disabled");
    }
    if (this.config.get("TWILIO_WHATSAPP_KILL_SWITCH") !== "false") {
      throw new ServiceUnavailableException("WhatsApp kill switch is active");
    }
    if (
      this.config.get("NODE_ENV") === "production" &&
      this.config.get("TWILIO_WHATSAPP_PRODUCTION_READY") !== "true"
    ) {
      throw new ServiceUnavailableException(
        "WhatsApp production readiness has not been approved",
      );
    }
    const allowed = this.config
      .get<string>("TWILIO_WHATSAPP_PILOT_ALLOWLIST", "")
      .split(",")
      .map((value) => value.trim().replace(/[\s()-]/g, ""))
      .filter(Boolean);
    const normalized = phone.trim().replace(/[\s()-]/g, "");
    if (!allowed.includes(normalized)) {
      throw new ServiceUnavailableException(
        "This phone number is not in the WhatsApp private pilot",
      );
    }
  }

  private useDevelopmentOtp() {
    return this.config.get("CUSTOMER_OTP_PROVIDER") === "development";
  }

  private startDevelopmentChallenge(): OtpStartResult {
    this.assertDevelopmentOtpIsSafe();
    const code = String(randomInt(100000, 1000000));
    return {
      provider: "development",
      reference: `dev:${randomUUID()}:${code}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    };
  }

  private assertDevelopmentOtpIsSafe() {
    const databaseSafetyMode = this.config.get<string>("DATABASE_SAFETY_MODE");
    const databaseUrl = this.config.get<string>("DATABASE_URL", "");
    const localDatabase = isLocalDatabaseUrl(databaseUrl);
    const explicitlyIsolated = databaseSafetyMode === "isolated";

    if (
      this.config.get("NODE_ENV") === "production" ||
      (!localDatabase && !explicitlyIsolated)
    ) {
      throw new ServiceUnavailableException(
        "Development OTP requires a local or explicitly isolated database",
      );
    }
  }

  private async request<T>(
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
          authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(values),
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException("WhatsApp verification failed");
    }
    return (await response.json()) as T;
  }
}

function isLocalDatabaseUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}
