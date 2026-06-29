import type { Response } from "express";

export const OWNER_SESSION_COOKIE = "ll_owner_session";
export const CUSTOMER_SESSION_COOKIE = "ll_customer_session";

export function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const pair of header.split(";")) {
    const [key, ...parts] = pair.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return undefined;
}

export function setSessionCookie(
  response: Response,
  name: string,
  token: string,
  expiresAt: Date,
) {
  response.cookie(name, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/api/v1",
  });
}

export function clearSessionCookie(response: Response, name: string) {
  response.clearCookie(name, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1",
  });
}
