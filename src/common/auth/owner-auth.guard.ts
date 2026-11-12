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

    // This guard runs on every owner request, so its cost is paid everywhere.
    // It used to be one nested read, which Prisma sends as five statements one
    // after another. It is now two waits: the session, then the three things
    // that depend only on the session's user, read side by side.
    const session = await this.prisma.ownerSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    // Nothing else is read for a missing, revoked or expired session.
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Session expired");
    }

    const activeMember = { userId: session.userId, status: "ACTIVE" as const };
    const [memberships, overrides, businesses] = await Promise.all([
      this.prisma.businessMember.findMany({
        where: activeMember,
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.memberPermissionOverride.findMany({
        where: { member: activeMember },
        select: { memberId: true, capability: true, allowed: true },
      }),
      this.prisma.business.findMany({
        where: { members: { some: activeMember } },
        select: { id: true, platformStatus: true },
      }),
    ]);

    const requestedBusinessId = request.header("x-business-id");
    const membership = requestedBusinessId
      ? memberships.find((entry) => entry.businessId === requestedBusinessId)
      : memberships[0];
    if (!membership) {
      throw new UnauthorizedException("No active business membership");
    }
    const business = businesses.find((entry) => entry.id === membership.businessId);
    const requestPath = request.path || request.originalUrl || "";
    const suspensionSafePath = ["/auth/me", "/auth/logout"].some((path) =>
      requestPath.endsWith(path),
    );
    if (
      business?.platformStatus === "SUSPENDED" &&
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
      // Only this membership's overrides: the read above covers every
      // business the user belongs to.
      capabilities: resolveCapabilities(
        membership.role,
        overrides.filter((entry) => entry.memberId === membership.id),
      ),
    };

    if (Date.now() - session.lastUsedAt.getTime() > 15 * 60 * 1000) {
      void this.prisma.ownerSession.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => undefined);
    }

    return true;
  }
}
