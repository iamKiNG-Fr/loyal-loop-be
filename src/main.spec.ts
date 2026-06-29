import { describe, expect, it } from "vitest";
import { isCorsOriginAllowed } from "./common/cors.util";

describe("isCorsOriginAllowed", () => {
  const configured = ["https://useloyalloop.com", "http://localhost:3000"];

  it("allows configured origins", () => {
    expect(isCorsOriginAllowed("https://useloyalloop.com", configured, "production")).toBe(true);
  });

  it("allows arbitrary local ports outside production", () => {
    expect(isCorsOriginAllowed("http://localhost:3001", configured, "development")).toBe(true);
    expect(isCorsOriginAllowed("http://127.0.0.1:4173", configured)).toBe(true);
  });

  it("keeps unconfigured origins restricted in production", () => {
    expect(isCorsOriginAllowed("http://localhost:3001", configured, "production")).toBe(false);
    expect(isCorsOriginAllowed("https://example.com", configured, "development")).toBe(false);
  });
});
