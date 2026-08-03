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
  OWNER_SESSION_COOKIE,
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
    const rawToken = readCookie(request.headers.cookie, OWNER_SESSION_COOKIE);
    const rawPlatformToken = readCookie(
      request.headers.cookie,
      PLATFORM_ADMIN_SESSION_COOKIE,
    );
    if (!rawToken || !rawPlatformToken) {
      throw new UnauthorizedException("Platform step-up verification required");
    }

    const session = await this.prisma.ownerSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: { include: { platformAdmin: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.user.platformAdmin?.status !== "ACTIVE"
    ) {
      throw new UnauthorizedException("Active platform administrator access required");
    }

    const platformSession = await this.prisma.platformAdminSession.findUnique({
      where: { tokenHash: hashToken(rawPlatformToken) },
    });
    if (
      !platformSession ||
      platformSession.platformAdminId !== session.user.platformAdmin.id ||
      platformSession.ownerSessionId !== session.id ||
      platformSession.revokedAt ||
      platformSession.expiresAt.getTime() <= Date.now() ||
      Date.now() - platformSession.lastUsedAt.getTime() > 30 * 60 * 1000
    ) {
      throw new UnauthorizedException("Platform step-up session expired");
    }

    request.platformAuth = {
      platformAdminId: session.user.platformAdmin.id,
      platformSessionId: platformSession.id,
      userId: session.userId,
      ownerSessionId: session.id,
      role: session.user.platformAdmin.role,
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
