import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { hashToken } from "../crypto.util";
import { OWNER_SESSION_COOKIE, readCookie } from "../http.util";
import type { LoyalLoopRequest } from "../request-context";
import { PrismaService } from "../../modules/prisma/prisma.service";
import { resolveCapabilities } from "./capabilities";

@Injectable()
export class OwnerAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    const rawToken = readCookie(request.headers.cookie, OWNER_SESSION_COOKIE);
    if (!rawToken) throw new UnauthorizedException("Sign in required");

    const session = await this.prisma.ownerSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: {
        user: {
          include: {
            memberships: {
              where: { status: "ACTIVE" },
              orderBy: { createdAt: "asc" },
              include: {
                permissionOverrides: true,
                business: { select: { platformStatus: true } },
              },
            },
          },
        },
      },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Session expired");
    }

    const requestedBusinessId = request.header("x-business-id");
    const membership = requestedBusinessId
      ? session.user.memberships.find(
          (entry) => entry.businessId === requestedBusinessId,
        )
      : session.user.memberships[0];
    if (!membership) {
      throw new UnauthorizedException("No active business membership");
    }
    const requestPath = request.path || request.originalUrl || "";
    const suspensionSafePath = ["/auth/me", "/auth/logout"].some((path) =>
      requestPath.endsWith(path),
    );
    if (
      membership.business?.platformStatus === "SUSPENDED" &&
      !suspensionSafePath
    ) {
      throw new ForbiddenException({
        error: "BUSINESS_SUSPENDED",
        message: "This business workspace is temporarily restricted. Contact Loyal Loop support.",
      });
    }

    request.auth = {
      userId: session.userId,
      sessionId: session.id,
      businessId: membership.businessId,
      memberId: membership.id,
      role: membership.role,
      capabilities: resolveCapabilities(
        membership.role,
        membership.permissionOverrides,
      ),
    };

    if (Date.now() - session.lastUsedAt.getTime() > 15 * 60 * 1000) {
      void this.prisma.ownerSession.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      });
    }

    return true;
  }
}
