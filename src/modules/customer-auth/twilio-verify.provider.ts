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
      const code = String(randomInt(100000, 1000000));
      return {
        provider: "development",
        reference: `dev:${randomUUID()}:${code}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      };
    }

    if (!this.isConfigured()) {
      if (this.config.get("NODE_ENV") === "production") {
        throw new ServiceUnavailableException("WhatsApp verification is not configured");
      }
      const code = String(randomInt(100000, 1000000));
      return {
        provider: "development",
        reference: `dev:${randomUUID()}:${code}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      };
    }

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

  private useDevelopmentOtp() {
    return this.config.get("CUSTOMER_OTP_PROVIDER") === "development";
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
