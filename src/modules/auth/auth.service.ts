import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createOpaqueToken, hashToken } from "../../common/crypto.util";
import { hashPassword, verifyPassword } from "../../common/password.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { ChangePasswordDto, ResetPasswordDto } from "./dto/password.dto";
import { RegisterOwnerDto } from "./dto/register-owner.dto";

type SessionMeta = {
  userAgent?: string;
  ipHash?: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterOwnerDto, meta: SessionMeta) {
    const passwordHash = await hashPassword(dto.password);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: dto.ownerName.trim(),
            email: dto.email.trim().toLowerCase(),
            passwordHash,
          },
        });
        const business = await tx.business.create({
          data: {
            ownerId: user.id,
            name: dto.businessName.trim(),
            slug: dto.slug,
            category: dto.category,
            categoryDetail: dto.categoryDetail,
            location: dto.location,
            pledgeSignature: dto.pledgeSignature,
            pledgedAt: dto.pledgeSignature ? new Date() : undefined,
            preferences: {
              create: { theme: dto.theme ?? "LOYAL_PURPLE" },
            },
            contacts: dto.contacts?.length
              ? {
                  create: dto.contacts.map((contact, index) => ({
                    platform: contact.platform,
                    value: contact.value.trim(),
                    isPrimary: contact.isPrimary ?? index === 0,
                    sortOrder: index,
                  })),
                }
              : undefined,
            members: {
              create: {
                userId: user.id,
                role: "OWNER",
                status: "ACTIVE",
                joinedAt: new Date(),
              },
            },
            activityEvents: {
              create: [
                {
                  actorId: user.id,
                  type: "BUSINESS_CREATED",
                  title: "Business created",
                },
                ...(dto.pledgeSignature
                  ? [
                      {
                        actorId: user.id,
                        type: "OWNER_PLEDGED" as const,
                        title: "Owner pledge completed",
                      },
                    ]
                  : []),
              ],
            },
          },
          include: { preferences: true, contacts: true },
        });
        return { user, business };
      });
      const session = await this.createSession(result.user.id, meta);
      return {
        ...this.safeIdentity(result.user, result.business),
        session,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Email or business link is already in use");
      }
      throw error;
    }
  }

  async login(email: string, password: string, meta: SessionMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: {
        memberships: {
          where: { status: "ACTIVE" },
          include: { business: { include: { preferences: true, contacts: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const membership = user.memberships[0];
    if (!membership) throw new UnauthorizedException("No active business");
    const session = await this.createSession(user.id, meta);
    return {
      ...this.safeIdentity(user, membership.business),
      session,
    };
  }

  async rotate(rawToken: string, meta: SessionMeta) {
    const existing = await this.prisma.ownerSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (
      !existing ||
      existing.revokedAt ||
      existing.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Session expired");
    }
    const replacement = createOpaqueToken();
    const expiresAt = this.sessionExpiry();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.ownerSession.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException("Session was already refreshed");
      }
      await tx.ownerSession.create({
        data: {
          userId: existing.userId,
          tokenHash: replacement.tokenHash,
          expiresAt,
          userAgent: meta.userAgent,
          ipHash: meta.ipHash,
        },
      });
    });
    return { token: replacement.token, expiresAt };
  }

  async logout(sessionId: string) {
    await this.prisma.ownerSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(auth: OwnerAuthContext) {
    const membership = await this.prisma.businessMember.findFirstOrThrow({
      where: {
        businessId: auth.businessId,
        userId: auth.userId,
        status: "ACTIVE",
      },
      include: {
        user: true,
        business: { include: { preferences: true, contacts: true } },
      },
    });
    return this.safeIdentity(membership.user, membership.business);
  }

  async changePassword(auth: OwnerAuthContext, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
    });
    if (!(await verifyPassword(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException("Current password is incorrect");
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      this.prisma.ownerSession.updateMany({
        where: { userId: user.id, id: { not: auth.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) return;

    const generated = createOpaqueToken();
    await this.prisma.passwordRecoveryToken.create({
      data: {
        userId: user.id,
        tokenHash: generated.tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    await this.mail.sendPasswordResetEmail({
      to: user.email,
      name: user.name,
      token: generated.token,
    });
  }

  async resetPassword(dto: ResetPasswordDto) {
    const recovery = await this.prisma.passwordRecoveryToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (
      !recovery ||
      recovery.usedAt ||
      recovery.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Reset link is invalid or expired");
    }
    const passwordHash = await hashPassword(dto.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: recovery.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordRecoveryToken.update({
        where: { id: recovery.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.ownerSession.updateMany({
        where: { userId: recovery.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  private async createSession(userId: string, meta: SessionMeta) {
    const generated = createOpaqueToken();
    const expiresAt = this.sessionExpiry();
    const session = await this.prisma.ownerSession.create({
      data: {
        userId,
        tokenHash: generated.tokenHash,
        expiresAt,
        userAgent: meta.userAgent,
        ipHash: meta.ipHash,
      },
    });
    return { id: session.id, token: generated.token, expiresAt };
  }

  private sessionExpiry() {
    const days = this.config.get<number>("OWNER_SESSION_DAYS", 30);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  private safeIdentity(
    user: { id: string; name: string; email: string; phone: string | null },
    business: unknown,
  ) {
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      business,
    };
  }
}
