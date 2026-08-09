import { describe, expect, it } from "vitest";
import {
  buildOnboardingEmailVerificationEmail,
  buildOnboardingEmailVerificationText,
  buildPasswordResetEmail,
  buildPasswordResetText,
} from "./mail.service";

describe("onboarding email verification", () => {
  it("renders the exact code, expiry, and never-share guidance", () => {
    const html = buildOnboardingEmailVerificationEmail({
      code: "123456",
      expiresInMinutes: 10,
    });
    const text = buildOnboardingEmailVerificationText({
      code: "123456",
      expiresInMinutes: 10,
    });

    expect(html).toContain("123456");
    expect(html).toContain("expires in 10 minutes");
    expect(html).toContain("Keep it private");
    expect(text).toContain("six-digit verification code is: 123456");
    expect(text).toContain("Never share this code");
  });
});

describe("password reset email", () => {
  it("uses Loyal Loop's social-first recovery copy and a one-time fragment link", () => {
    const resetUrl = "https://www.useloyalloop.com/auth/reset-password#token=opaque-token";
    const html = buildPasswordResetEmail({
      name: "Ada &amp; Co",
      resetUrl,
    });
    const text = buildPasswordResetText({ name: "Ada", resetUrl });

    expect(html).toContain("Your customers are still here.");
    expect(html).toContain("expires in 30 minutes");
    expect(html).toContain("family=DM+Sans");
    expect(html).toContain("family=Space+Grotesk");
    expect(html).toContain("background:#f1ecfb");
    expect(html).toContain("background:#edf7f3");
    expect(html).not.toMatch(/linear-gradient|radial-gradient/);
    expect(html).toContain(resetUrl);
    expect(text).toContain("works once");
    expect(resetUrl).toContain("#token=");
  });

  it("renders only pre-escaped identity content in the HTML template", () => {
    const html = buildPasswordResetEmail({
      name: "&lt;script&gt;alert(1)&lt;/script&gt;",
      resetUrl: "https://www.useloyalloop.com/auth/reset-password#token=safe",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
