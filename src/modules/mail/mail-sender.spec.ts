import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { mailSender } from "./mail-sender";

describe("optional email identities", () => {
  const existing = { EMAIL_FROM: "Existing <hello@example.com>", EMAIL_REPLY_TO: "reply@example.com" };
  it("preserves the existing sender for both purposes until configured", () => {
    for (const purpose of ["SECURITY", "UPDATES", "FOUNDER"] as const) {
      expect(mailSender(new ConfigService(existing), purpose)).toEqual({ from: existing.EMAIL_FROM, replyTo: existing.EMAIL_REPLY_TO });
    }
    expect(mailSender(new ConfigService({ ...existing, EMAIL_SECURITY_FROM: "   " }), "SECURITY").from).toBe(existing.EMAIL_FROM);
  });
  it("isolates security and update overrides from founder mail", () => {
    const config = new ConfigService({ ...existing, EMAIL_SECURITY_FROM: "Security <security@example.com>", EMAIL_UPDATES_FROM: "Updates <updates@example.com>" });
    expect(mailSender(config, "SECURITY").from).toContain("Security");
    expect(mailSender(config, "UPDATES").from).toContain("Updates");
    expect(mailSender(config, "FOUNDER").from).toBe(existing.EMAIL_FROM);
  });
});
