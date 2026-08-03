import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import { isCorsOriginAllowed } from "../cors.util";
import { CsrfService } from "./csrf.service";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly csrf: CsrfService,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext) {
    if (this.config.get<string>("CSRF_ENFORCED", "true") !== "true") {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase()) || !this.csrf.hasSessionCookie(request)) {
      return true;
    }

    const origin = request.header("origin");
    const fetchSite = request.header("sec-fetch-site");
    if (fetchSite === "cross-site" || !this.originAllowed(origin)) {
      throw this.failure();
    }

    if (!this.csrf.verify(request, request.header("x-csrf-token"))) {
      throw this.failure();
    }
    return true;
  }

  private originAllowed(origin: string | undefined) {
    if (!origin) return true;
    const configured = this.config
      .get<string>("CORS_ORIGINS", "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return isCorsOriginAllowed(origin, configured, this.config.get("NODE_ENV"));
  }

  private failure() {
    return new ForbiddenException({
      error: "CSRF_VALIDATION_FAILED",
      message: "This request could not be verified. Refresh the page and try again.",
    });
  }
}
