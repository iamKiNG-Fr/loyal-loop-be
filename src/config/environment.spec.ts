import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./environment";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://example.invalid/loyalloop",
  SESSION_HASH_SECRET: "s".repeat(32),
  CSRF_SECRET: "c".repeat(32),
  ANALYTICS_HMAC_SECRET: "a".repeat(32),
  CSRF_ENFORCED: "false",
  APP_URL: "https://www.useloyalloop.com",
  CORS_ORIGINS: "https://www.useloyalloop.com",
  TRUST_PROXY: "1",
};

describe("validateEnvironment", () => {
  it("accepts an explicit production security configuration", () => {
    expect(validateEnvironment(production)).toMatchObject(production);
  });

  it("rejects localhost in production CORS", () => {
    expect(() => validateEnvironment({ ...production, CORS_ORIGINS: "http://localhost:3000" }))
      .toThrow("CORS_ORIGINS cannot include localhost");
  });

  it("requires independent security secrets in production", () => {
    expect(() => validateEnvironment({ ...production, CSRF_SECRET: "short" }))
      .toThrow("CSRF_SECRET");
  });

  it("rejects reuse of a valid-length security secret", () => {
    expect(() => validateEnvironment({
      ...production,
      CSRF_SECRET: production.SESSION_HASH_SECRET,
    })).toThrow("must be independent");
  });

  it("requires an explicit CSRF rollout state in production", () => {
    const { CSRF_ENFORCED: _csrfEnforced, ...withoutCsrfState } = production;
    expect(() => validateEnvironment(withoutCsrfState)).toThrow("CSRF_ENFORCED is required");
  });

  it("requires the admin origin to be allowed by CORS", () => {
    expect(() => validateEnvironment({
      ...production,
      ADMIN_PORTAL_ENABLED: "true",
      ADMIN_ORIGINS: "https://admin.useloyalloop.com",
    })).toThrow("must also be present in CORS_ORIGINS");
  });

  it("requires passkey relying-party settings when enabled", () => {
    expect(() => validateEnvironment({
      ...production,
      ADMIN_PASSKEY_ENABLED: "true",
    })).toThrow("ADMIN_WEBAUTHN_RP_ID");
  });

  it("does not allow required passkeys while the passkey feature is disabled", () => {
    expect(() => validateEnvironment({
      ...production,
      ADMIN_PASSKEY_REQUIRED: "true",
      ADMIN_PASSKEY_ENABLED: "false",
    })).toThrow("ADMIN_PASSKEY_REQUIRED requires ADMIN_PASSKEY_ENABLED=true");
  });

  it("keeps at least one administrator authentication path enabled", () => {
    expect(() => validateEnvironment({
      ...production,
      CORS_ORIGINS: "https://www.useloyalloop.com,https://admin.useloyalloop.com",
      ADMIN_PORTAL_ENABLED: "true",
      ADMIN_ORIGINS: "https://admin.useloyalloop.com",
      ADMIN_PASSKEY_ENABLED: "false",
      ADMIN_WHATSAPP_FALLBACK_ENABLED: "false",
    })).toThrow("requires passkeys or the WhatsApp fallback");
  });
});
