import type { Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearSessionCookie,
  OWNER_SESSION_COOKIE,
  setSessionCookie,
} from "./http.util";

describe("session cookie utilities", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("sets an HTTP-only session cookie that is available to frontend routes", () => {
    process.env.NODE_ENV = "development";
    const cookie = vi.fn();
    const response = { cookie } as unknown as Response;
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");

    setSessionCookie(response, OWNER_SESSION_COOKIE, "redacted-token", expiresAt);

    expect(cookie).toHaveBeenCalledWith(
      OWNER_SESSION_COOKIE,
      "redacted-token",
      expect.objectContaining({
        expires: expiresAt,
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: false,
      }),
    );
  });

  it("clears the cookie with the same root path used when setting it", () => {
    process.env.NODE_ENV = "production";
    const clearCookie = vi.fn();
    const response = { clearCookie } as unknown as Response;

    clearSessionCookie(response, OWNER_SESSION_COOKIE);

    expect(clearCookie).toHaveBeenCalledWith(
      OWNER_SESSION_COOKIE,
      expect.objectContaining({
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: true,
      }),
    );
  });
});
