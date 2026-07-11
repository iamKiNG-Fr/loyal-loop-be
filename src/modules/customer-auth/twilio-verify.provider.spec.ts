import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { TwilioVerifyProvider } from "./twilio-verify.provider";

describe("TwilioVerifyProvider environment safety", () => {
  it("allows development OTP with a local database", async () => {
    const provider = new TwilioVerifyProvider(
      config({
        CUSTOMER_OTP_PROVIDER: "development",
        DATABASE_URL: "postgresql://local-placeholder@localhost:5432/loyalloop",
        NODE_ENV: "development",
      }),
    );

    await expect(provider.start("+2348012345678")).resolves.toMatchObject({
      provider: "development",
    });
  });

  it("allows development OTP with an explicitly isolated remote database", async () => {
    const provider = new TwilioVerifyProvider(
      config({
        CUSTOMER_OTP_PROVIDER: "development",
        DATABASE_SAFETY_MODE: "isolated",
        DATABASE_URL: "postgresql://isolated-placeholder@db.example.test/loyalloop",
        NODE_ENV: "development",
      }),
    );

    await expect(provider.start("+2348012345678")).resolves.toMatchObject({
      provider: "development",
    });
  });

  it("blocks development OTP against an unclassified remote database", async () => {
    const provider = new TwilioVerifyProvider(
      config({
        CUSTOMER_OTP_PROVIDER: "development",
        DATABASE_URL: "postgresql://shared-placeholder@db.example.test/loyalloop",
        NODE_ENV: "development",
      }),
    );

    await expect(provider.start("+2348012345678")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it("blocks development OTP in production even when data is isolated", async () => {
    const provider = new TwilioVerifyProvider(
      config({
        CUSTOMER_OTP_PROVIDER: "development",
        DATABASE_SAFETY_MODE: "isolated",
        DATABASE_URL: "postgresql://isolated-placeholder@db.example.test/loyalloop",
        NODE_ENV: "production",
      }),
    );

    await expect(provider.start("+2348012345678")).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

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
