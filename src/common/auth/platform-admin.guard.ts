import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { hashToken, hmacPrivateValue } from "../crypto.util";
import {
  PLATFORM_ADMIN_SESSION_COOKIE,
  readCookie,
} from "../http.util";
import type { LoyalLoopRequest } from "../request-context";
import { PrismaService } from "../../modules/prisma/prisma.service";

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (this.config.get<string>("ADMIN_PORTAL_ENABLED", "false") !== "true") {
      throw new NotFoundException("Platform administration is not available");
    }
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    request.requestId ||= randomUUID();
    const rawPlatformToken = readCookie(
      request.headers.cookie,
      PLATFORM_ADMIN_SESSION_COOKIE,
    );
    if (!rawPlatformToken) {
      throw new UnauthorizedException("Platform step-up verification required");
    }

    const platformSession = await this.prisma.platformAdminSession.findUnique({
      where: { tokenHash: hashToken(rawPlatformToken) },
      include: {
        platformAdmin: { include: { user: true } },
      },
    });
    if (
      !platformSession ||
      platformSession.platformAdmin.status !== "ACTIVE" ||
      platformSession.revokedAt ||
      platformSession.expiresAt.getTime() <= Date.now() ||
      Date.now() - platformSession.lastUsedAt.getTime() > 30 * 60 * 1000
    ) {
      throw new UnauthorizedException("Platform step-up session expired");
    }

    request.platformAuth = {
      platformAdminId: platformSession.platformAdmin.id,
      platformSessionId: platformSession.id,
      userId: platformSession.platformAdmin.userId,
      ownerSessionId: platformSession.ownerSessionId ?? undefined,
      role: platformSession.platformAdmin.role,
      verifiedAt: platformSession.verifiedAt,
      requestId: request.requestId,
      ipHash: hmacPrivateValue(
        request.ip || "unknown",
        this.config.get<string>("SESSION_HASH_SECRET") ||
          "development-admin-request-secret",
      ),
      userAgent: request.header("user-agent")?.slice(0, 500),
    };
    if (Date.now() - platformSession.lastUsedAt.getTime() > 60_000) {
      void this.prisma.platformAdminSession.update({
        where: { id: platformSession.id },
        data: { lastUsedAt: new Date() },
      });
    }
    return true;
  }
}
