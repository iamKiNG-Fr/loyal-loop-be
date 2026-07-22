import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createOpaqueToken,
  createPublicCardId,
  hashToken,
} from "../../common/crypto.util";
import { hashPassword, verifyPassword } from "../../common/password.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import type {
  BusinessCapability,
  BusinessRole,
} from "../../generated/prisma/client";
import { resolveCapabilities } from "../../common/auth/capabilities";
import { MailService } from "../mail/mail.service";
import { OTP_PROVIDER, type OtpProvider } from "../customer-auth/otp-provider";
import { normalizeE164 } from "../messaging/twilio-whatsapp.provider";
import { PrismaService } from "../prisma/prisma.service";
import { FoundingCircleService } from "../founding-circle/founding-circle.service";
import { ChangePasswordDto, ResetPasswordDto } from "./dto/password.dto";
import { RegisterOwnerDto } from "./dto/register-owner.dto";

type SessionMeta = {
  userAgent?: string;
  ipHash?: string;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly founding: FoundingCircleService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
  ) {}

  async register(dto: RegisterOwnerDto, meta: SessionMeta, rawGrant?: string) {
    if (dto.allowedPaymentMethods?.length === 0) {
      throw new BadRequestException("Choose at least one accepted payment method");
    }
    if (dto.defaultPaymentMethod && dto.allowedPaymentMethods && !dto.allowedPaymentMethods.includes(dto.defaultPaymentMethod)) {
      throw new BadRequestException("Default payment method must be accepted by the business");
    }
    const passwordHash = await hashPassword(dto.password);
    const ownerPhone = primaryWhatsappPhone(dto.contacts);
    if (!ownerPhone) {
      throw new BadRequestException(
        "Add and verify a WhatsApp number before creating the business",
      );
    }
    const foundingGrant = this.founding.resolveRegistrationGrant(rawGrant);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: dto.ownerName.trim(),
            email: dto.email.trim().toLowerCase(),
            passwordHash,
            phone: ownerPhone,
          },
        });
        const claimedVerification = await tx.ownerOtpChallenge.updateMany({
          where: {
            id: dto.phoneVerificationChallengeId,
            phone: ownerPhone,
            userId: null,
            verifiedAt: { not: null },
            expiresAt: { gt: new Date() },
          },
          data: { userId: user.id },
        });
        if (claimedVerification.count !== 1) {
          throw new BadRequestException(
            "Verify this WhatsApp number again before creating the business",
          );
        }
        const business = await tx.business.create({
          data: {
            ownerId: user.id,
            name: dto.businessName.trim(),
            slug: dto.slug,
            publicCardId: createPublicCardId(),
            category: dto.category,
            categoryDetail: dto.categoryDetail,
            location: dto.location,
            storeStatus: "SETTING_UP",
            pledgeSignature: dto.pledgeSignature,
            pledgedAt: dto.pledgeSignature ? new Date() : undefined,
            preferences: {
              create: {
                theme: dto.theme ?? "LOYAL_PURPLE",
                allowedPaymentMethods: dto.allowedPaymentMethods,
                defaultPaymentMethod: dto.defaultPaymentMethod,
              },
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
        await this.founding.redeemInTransaction(tx, foundingGrant, {
          businessId: business.id,
          email: user.email,
          phone: ownerPhone,
          userId: user.id,
        });
        return { user, business };
      });
      const session = await this.createSession(result.user.id, meta);
      return {
        ...this.safeIdentity(result.user, result.business, { role: "OWNER" }),
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
        avatarAsset: true,
        memberships: {
          where: { status: "ACTIVE" },
          include: {
            permissionOverrides: true,
            business: {
              include: {
                preferences: true,
                contacts: true,
                logoAsset: true,
                coverAsset: true,
              },
            },
          },
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
      ...this.safeIdentity(user, membership.business, membership),
      session,
    };
  }

  async startWhatsapp(phone: string) {
    const normalizedPhone = normalizeE164(phone);
    const user = await this.prisma.user.findUnique({
      where: { phone: normalizedPhone },
      select: { id: true },
    });
    if (!user) {
      throw new UnauthorizedException(
        "No business workspace uses this as its primary WhatsApp number",
      );
    }

    const started = await this.otpProvider.start(normalizedPhone);
    const challenge = await this.prisma.ownerOtpChallenge.create({
        data: {
          userId: user.id,
          phone: normalizedPhone,
          provider: started.provider,
          providerReference: started.reference,
          expiresAt: started.expiresAt,
          purpose: "LOGIN",
        },
    });
    return {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
    };
  }

  async startOnboardingWhatsapp(phone: string) {
    const normalizedPhone = normalizeE164(phone);
    const started = await this.otpProvider.start(normalizedPhone);
    await this.prisma.ownerOtpChallenge.updateMany({
      where: {
        phone: normalizedPhone,
        userId: null,
        verifiedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { expiresAt: new Date() },
    });
    const challenge = await this.prisma.ownerOtpChallenge.create({
        data: {
          phone: normalizedPhone,
          provider: started.provider,
          providerReference: started.reference,
          expiresAt: started.expiresAt,
          purpose: "ONBOARDING",
        },
    });
    return {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
    };
  }

  async verifyOnboardingWhatsapp(challengeId: string, code: string) {
    const challenge = await this.prisma.ownerOtpChallenge.findUnique({
      where: { id: challengeId, purpose: "ONBOARDING" },
    });
    if (
      !challenge ||
      challenge.userId ||
      challenge.verifiedAt ||
      challenge.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Verification challenge expired");
    }
    if (challenge.attempts >= 5) {
      throw new UnauthorizedException("Too many verification attempts");
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

    const verifiedAt = new Date();
    const expiresAt = new Date(
      verifiedAt.getTime() + this.onboardingProofMinutes() * 60_000,
    );
    await this.prisma.ownerOtpChallenge.update({
      where: { id: challenge.id },
      data: { verifiedAt, expiresAt },
    });
    return { challengeId: challenge.id, expiresAt, verifiedAt };
  }

  async verifyWhatsapp(
    challengeId: string,
    code: string,
    meta: SessionMeta,
  ) {
    const challenge = await this.prisma.ownerOtpChallenge.findUnique({
      where: { id: challengeId, purpose: "LOGIN" },
    });
    if (
      !challenge ||
      !challenge.userId ||
      challenge.verifiedAt ||
      challenge.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Verification challenge expired");
    }
    if (challenge.attempts >= 5) {
      throw new UnauthorizedException("Too many verification attempts");
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

    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      include: {
        avatarAsset: true,
        memberships: {
          where: { status: "ACTIVE" },
          include: {
            permissionOverrides: true,
            business: {
              include: {
                preferences: true,
                contacts: true,
                logoAsset: true,
                coverAsset: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    const membership = user?.memberships[0];
    if (!user || !membership) {
      throw new UnauthorizedException("No active business");
    }

    await this.prisma.ownerOtpChallenge.update({
      where: { id: challenge.id },
      data: { verifiedAt: new Date() },
    });
    const session = await this.createSession(user.id, meta);
    return {
      ...this.safeIdentity(user, membership.business, membership),
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
        permissionOverrides: true,
        user: { include: { avatarAsset: true } },
        business: {
          include: {
            preferences: true,
            contacts: true,
            logoAsset: true,
            coverAsset: true,
          },
        },
      },
    });
    return this.safeIdentity(membership.user, membership.business, membership);
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
    const now = new Date();
    const [, recovery] = await this.prisma.$transaction([
      this.prisma.passwordRecoveryToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.passwordRecoveryToken.create({
        data: {
          userId: user.id,
          tokenHash: generated.tokenHash,
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        },
      }),
    ]);
    try {
      await this.mail.sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        token: generated.token,
      });
    } catch (error) {
      await this.prisma.passwordRecoveryToken.update({
        where: { id: recovery.id },
        data: { usedAt: new Date() },
      });
      this.logger.error(
        `Password reset email failed for user ${user.id}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
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
      this.prisma.passwordRecoveryToken.updateMany({
        where: { userId: recovery.userId, usedAt: null },
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

  private onboardingProofMinutes() {
    return Math.min(
      Math.max(
        Number(this.config.get("OWNER_ONBOARDING_PHONE_PROOF_MINUTES") || 30),
        5,
      ),
      60,
    );
  }

  private safeIdentity(
    user: {
      id: string;
      name: string;
      email: string;
      phone: string | null;
      avatarAsset?: { id: string; secureUrl: string } | null;
    },
    business: unknown,
    membership: {
      id?: string;
      role: BusinessRole;
      permissionOverrides?: Array<{
        capability: BusinessCapability;
        allowed: boolean;
      }>;
    },
  ) {
    const capabilities = resolveCapabilities(
      membership.role,
      membership.permissionOverrides,
    );
    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        avatarAsset: user.avatarAsset ?? null,
      },
      business,
      workspace: {
        memberId: membership.id ?? null,
        role: membership.role,
        capabilities,
      },
    };
  }
}

function primaryWhatsappPhone(
  contacts: RegisterOwnerDto["contacts"] | undefined,
) {
  const whatsapp = contacts
    ?.filter((contact) => contact.platform === "WHATSAPP")
    .sort((left, right) => Number(Boolean(right.isPrimary)) - Number(Boolean(left.isPrimary)))[0];
  return whatsapp ? normalizeE164(whatsapp.value) : undefined;
}
