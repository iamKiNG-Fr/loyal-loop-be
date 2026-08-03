import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { CsrfService } from "./csrf.service";

function request(cookie?: string) {
  return { headers: { cookie } } as Request;
}

describe("CsrfService", () => {
  const service = new CsrfService(new ConfigService({
    CSRF_SECRET: "csrf-test-secret-that-is-long-enough",
  }));

  it("binds a token to the active session cookie", () => {
    const first = request("ll_owner_session=owner-one");
    const second = request("ll_owner_session=owner-two");
    const token = service.issue(first);

    expect(token).toBeTruthy();
    expect(service.verify(first, token!)).toBe(true);
    expect(service.verify(second, token!)).toBe(false);
  });

  it("does not require a token without a session cookie", () => {
    expect(service.issue(request())).toBeNull();
    expect(service.verify(request(), undefined)).toBe(true);
  });

  it("binds administrator writes to the standalone platform session", () => {
    const admin = request("ll_platform_admin_session=admin-one");
    const other = request("ll_platform_admin_session=admin-two");
    const token = service.issue(admin);

    expect(service.verify(admin, token!)).toBe(true);
    expect(service.verify(other, token!)).toBe(false);
  });
});
