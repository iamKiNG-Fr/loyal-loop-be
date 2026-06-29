import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { hashToken } from "../crypto.util";
import { CUSTOMER_SESSION_COOKIE, readCookie } from "../http.util";
import type { LoyalLoopRequest } from "../request-context";
import { PrismaService } from "../../modules/prisma/prisma.service";

@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<LoyalLoopRequest>();
    const rawToken = readCookie(request.headers.cookie, CUSTOMER_SESSION_COOKIE);
    if (!rawToken) throw new UnauthorizedException("Customer sign in required");

    const session = await this.prisma.customerAccountSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Customer session expired");
    }

    request.customerAuth = {
      customerAccountId: session.customerAccountId,
      sessionId: session.id,
    };
    return true;
  }
}
