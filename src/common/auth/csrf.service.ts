import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import {
  CUSTOMER_SESSION_COOKIE,
  ONBOARDING_GRANT_COOKIE,
  OWNER_SESSION_COOKIE,
  readCookie,
} from "../http.util";

@Injectable()
export class CsrfService {
  constructor(private readonly config: ConfigService) {}

  issue(request: Request) {
    const binding = this.sessionBinding(request);
    return binding ? this.sign(binding) : null;
  }

  verify(request: Request, candidate: string | undefined) {
    const binding = this.sessionBinding(request);
    if (!binding) return true;
    if (!candidate) return false;
    const expected = Buffer.from(this.sign(binding));
    const actual = Buffer.from(candidate);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  hasSessionCookie(request: Request) {
    return Boolean(this.sessionBinding(request));
  }

  private sessionBinding(request: Request) {
    const cookie = request.headers.cookie;
    const owner = readCookie(cookie, OWNER_SESSION_COOKIE);
    if (owner) return `${OWNER_SESSION_COOKIE}:${owner}`;
    const customer = readCookie(cookie, CUSTOMER_SESSION_COOKIE);
    if (customer) return `${CUSTOMER_SESSION_COOKIE}:${customer}`;
    const onboarding = readCookie(cookie, ONBOARDING_GRANT_COOKIE);
    return onboarding ? `${ONBOARDING_GRANT_COOKIE}:${onboarding}` : null;
  }

  private sign(binding: string) {
    const secret = this.config.get<string>("CSRF_SECRET")
      || this.config.get<string>("SESSION_HASH_SECRET")
      || "development-csrf-secret";
    return createHmac("sha256", secret).update(`csrf:v1:${binding}`).digest("base64url");
  }
}
