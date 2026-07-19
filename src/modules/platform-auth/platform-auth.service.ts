import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createOpaqueToken, hashToken } from "../../common/crypto.util";
import { normalizeE164 } from "../messaging/twilio-whatsapp.provider";
import { PrismaService } from "../prisma/prisma.service";
import { OTP_PROVIDER, type OtpProvider } from "../customer-auth/otp-provider";

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
  ) {}

  async current(rawOwnerToken?: string, rawPlatformToken?: string) {
    this.assertEnabled();
    const context = await this.ownerAdmin(rawOwnerToken);
    if (!rawPlatformToken) return this.publicAdmin(context, true);
    const platformSession = await this.prisma.platformAdminSession.findUnique({
      where: { tokenHash: hashToken(rawPlatformToken) },
    });
    const valid = Boolean(
      platformSession &&
        platformSession.platformAdminId === context.admin.id &&
        platformSession.ownerSessionId === context.ownerSession.id &&
        !platformSession.revokedAt &&
        platformSession.expiresAt.getTime() > Date.now() &&
        Date.now() - platformSession.lastUsedAt.getTime() <= 30 * 60 * 1000,
    );
    return this.publicAdmin(context, !valid);
  }

  async start(rawOwnerToken?: string) {
    this.assertEnabled();
    const context = await this.ownerAdmin(rawOwnerToken);
    if (!context.user.phone) {
      throw new ForbiddenException("Connect a verified WhatsApp number before using platform admin");
    }
    const phone = normalizeE164(context.user.phone);
    const started = await this.otpProvider.start(phone);
    const challenge = await this.prisma.ownerOtpChallenge.create({
      data: {
        userId: context.user.id,
        phone,
        provider: started.provider,
        providerReference: started.reference,
        expiresAt: started.expiresAt,
        purpose: "PLATFORM_ADMIN_STEP_UP",
      },
    });
    return { challengeId: challenge.id, expiresAt: challenge.expiresAt };
  }

  async verify(rawOwnerToken: string | undefined, challengeId: string, code: string) {
    this.assertEnabled();
    const context = await this.ownerAdmin(rawOwnerToken);
    const challenge = await this.prisma.ownerOtpChallenge.findFirst({
      where: {
        id: challengeId,
        userId: context.user.id,
        purpose: "PLATFORM_ADMIN_STEP_UP",
      },
    });
    if (
      !challenge ||
      challenge.verifiedAt ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.attempts >= 5
    ) {
      throw new UnauthorizedException("Platform verification expired");
    }
    await this.prisma.ownerOtpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    const approved = await this.otpProvider.verify(
      challenge.providerReference,
      challenge.phone,
      code,
    );
    if (!approved) throw new UnauthorizedException("Invalid verification code");
    const generated = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const now = new Date();
    const platformSession = await this.prisma.$transaction(async (tx) => {
      await tx.ownerOtpChallenge.update({
        where: { id: challenge.id },
        data: { verifiedAt: now },
      });
      const session = await tx.platformAdminSession.create({
        data: {
          platformAdminId: context.admin.id,
          ownerSessionId: context.ownerSession.id,
          tokenHash: generated.tokenHash,
          verifiedAt: now,
          expiresAt,
        },
      });
      await tx.platformAdminAuditLog.create({
        data: {
          actorAdminId: context.admin.id,
          action: "PLATFORM_ADMIN_STEP_UP",
          targetType: "PlatformAdminSession",
          targetId: session.id,
        },
      });
      return session;
    });
    return {
      token: generated.token,
      expiresAt,
      platformSessionId: platformSession.id,
      admin: this.publicAdmin(context, false),
    };
  }

  async logout(rawPlatformToken?: string) {
    this.assertEnabled();
    if (!rawPlatformToken) return;
    await this.prisma.platformAdminSession.updateMany({
      where: { tokenHash: hashToken(rawPlatformToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async ownerAdmin(rawOwnerToken?: string) {
    if (!rawOwnerToken) throw new UnauthorizedException("Owner sign in required");
    const ownerSession = await this.prisma.ownerSession.findUnique({
      where: { tokenHash: hashToken(rawOwnerToken) },
      include: { user: { include: { platformAdmin: true } } },
    });
    if (
      !ownerSession ||
      ownerSession.revokedAt ||
      ownerSession.expiresAt.getTime() <= Date.now() ||
      ownerSession.user.platformAdmin?.status !== "ACTIVE"
    ) {
      throw new UnauthorizedException("Active platform administrator access required");
    }
    return {
      ownerSession,
      user: ownerSession.user,
      admin: ownerSession.user.platformAdmin,
    };
  }

  private assertEnabled() {
    if (this.config.get<string>("ADMIN_PORTAL_ENABLED", "false") !== "true") {
      throw new NotFoundException("Platform administration is not available");
    }
  }

  private publicAdmin(
    context: Awaited<ReturnType<PlatformAuthService["ownerAdmin"]>>,
    stepUpRequired: boolean,
  ) {
    return {
      user: {
        id: context.user.id,
        name: context.user.name,
        email: context.user.email,
        phone: context.user.phone,
      },
      platformAdmin: {
        id: context.admin.id,
        role: context.admin.role,
        status: context.admin.status,
      },
      stepUpRequired,
    };
  }
}
