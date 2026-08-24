import { describe, expect, it } from "vitest";
import { isCorsOriginAllowed } from "./common/cors.util";

describe("isCorsOriginAllowed", () => {
  const configured = [
    "https://useloyalloop.com",
    "https://www.useloyalloop.com",
    "http://localhost:3000",
  ];

  it("allows configured origins", () => {
    expect(isCorsOriginAllowed("https://useloyalloop.com", configured, "production")).toBe(true);
    expect(isCorsOriginAllowed("https://www.useloyalloop.com", configured, "production")).toBe(true);
  });

  it("allows a single merchant slug on the owned production host", () => {
    expect(
      isCorsOriginAllowed(
        "https://kings-store-demo.useloyalloop.com",
        configured,
        "production",
      ),
    ).toBe(true);
  });

  it("allows arbitrary local ports outside production", () => {
    expect(isCorsOriginAllowed("http://localhost:3001", configured, "development")).toBe(true);
    expect(isCorsOriginAllowed("http://127.0.0.1:4173", configured)).toBe(true);
  });

  it("keeps unconfigured origins restricted in production", () => {
    expect(isCorsOriginAllowed("http://localhost:3001", configured, "production")).toBe(false);
    expect(isCorsOriginAllowed("https://example.com", configured, "development")).toBe(false);
  });

  it.each([
    "http://kings-store-demo.useloyalloop.com",
    "https://kings-store-demo.useloyalloop.com:444",
    "https://preview.kings-store-demo.useloyalloop.com",
    "https://kings-store-demo.useloyalloop.com.evil.example",
    "https://-kings-store-demo.useloyalloop.com",
    "https://kings-store-demo-.useloyalloop.com",
    "https://admin.useloyalloop.com",
    "https://api.useloyalloop.com",
    "https://app.useloyalloop.com",
    "https://assets.useloyalloop.com",
    "https://cdn.useloyalloop.com",
    "https://help.useloyalloop.com",
    "https://mail.useloyalloop.com",
    "https://status.useloyalloop.com",
    "https://support.useloyalloop.com",
  ])("rejects lookalike or reserved merchant origin %s", (origin) => {
    expect(isCorsOriginAllowed(origin, configured, "production")).toBe(false);
  });
});
