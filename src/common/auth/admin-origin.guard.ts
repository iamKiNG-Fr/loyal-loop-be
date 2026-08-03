import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { LoyalLoopRequest } from "../request-context";

@Injectable()
export class AdminOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    if (this.config.get<string>("ADMIN_ORIGIN_ENFORCED", "false") !== "true") {
      return true;
    }
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    const origin = request.header("origin");
    const allowed = new Set(
      (this.config.get<string>("ADMIN_ORIGINS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    if ((origin && !allowed.has(origin)) || (unsafe && !origin)) {
      throw new ForbiddenException("Platform administration origin is not allowed");
    }
    return true;
  }
}
