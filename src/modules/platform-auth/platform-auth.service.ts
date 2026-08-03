import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import { randomBytes, randomUUID } from "node:crypto";
import type { PlatformAdmin, User } from "../../generated/prisma/client";
import {
  createOpaqueToken,
  hashToken,
  hmacPrivateValue,
} from "../../common/crypto.util";
import { normalizeE164 } from "../messaging/twilio-whatsapp.provider";
import { PrismaService } from "../prisma/prisma.service";
import { OTP_PROVIDER, type OtpProvider } from "../customer-auth/otp-provider";
import type {
  VerifyPasskeyAuthenticationDto,
  VerifyPasskeyRegistrationDto,
} from "./dto/platform-auth.dto";

type PlatformSessionMeta = { ip?: string; userAgent?: string };
type AdminContext = { admin: PlatformAdmin; user: User };

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(OTP_PROVIDER) private readonly otpProvider: OtpProvider,
  ) {}

  methods() {
    this.assertEnabled();
    return {
      passkeysEnabled:
        this.config.get<string>("ADMIN_PASSKEY_ENABLED", "false") === "true",
      whatsappEnabled:
        this.config.get<string>("ADMIN_WHATSAPP_FALLBACK_ENABLED", "true") ===
        "true",
      recoveryCodesEnabled:
        this.config.get<string>("ADMIN_PASSKEY_ENABLED", "false") === "true",
    };
  }

  async current(rawPlatformToken?: string) {
    this.assertEnabled();
    if (!rawPlatformToken) return null;
    const platformSession = await this.prisma.platformAdminSession.findUnique({
      where: { tokenHash: hashToken(rawPlatformToken) },
      include: { platformAdmin: { include: { user: true } } },
    });
    const valid = Boolean(
      platformSession &&
        platformSession.platformAdmin.status === "ACTIVE" &&
        !platformSession.revokedAt &&
        platformSession.expiresAt.getTime() > Date.now() &&
        Date.now() - platformSession.lastUsedAt.getTime() <= 30 * 60 * 1000,
    );
    if (!valid || !platformSession) return null;
    return this.publicAdmin({
      admin: platformSession.platformAdmin,
      user: platformSession.platformAdmin.user,
    }, false);
  }

  async start(identifier: string, meta: PlatformSessionMeta = {}) {
    this.assertEnabled();
    const context = await this.adminByIdentifier(identifier);
    await this.assertWhatsappPermitted(context.admin.id);
    if (!context.user.phone) {
      throw new ForbiddenException("Connect a verified WhatsApp number before using platform admin");
    }
    const phone = normalizeE164(context.user.phone);
    const started = await this.otpProvider.start(phone);
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.ownerOtpChallenge.updateMany({
        where: {
          userId: context.user.id,
          purpose: "PLATFORM_ADMIN_STEP_UP",
          verifiedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { expiresAt: new Date() },
      });
      const created = await tx.ownerOtpChallenge.create({
        data: {
          userId: context.user.id,
          phone,
          provider: started.provider,
          providerReference: started.reference,
          expiresAt: started.expiresAt,
          purpose: "PLATFORM_ADMIN_STEP_UP",
        },
      });
      await tx.platformAdminAuditLog.create({
        data: {
          actorAdminId: context.admin.id,
          action: "PLATFORM_ADMIN_WHATSAPP_CHALLENGE_STARTED",
          targetType: "OwnerOtpChallenge",
          targetId: created.id,
          requestId: randomUUID(),
          ...this.sessionMeta(meta),
        },
      });
      return created;
    });
    return { challengeId: challenge.id, expiresAt: challenge.expiresAt };
  }

  async verify(
    challengeId: string,
    code: string,
    meta: PlatformSessionMeta = {},
  ) {
    this.assertEnabled();
    const challenge = await this.prisma.ownerOtpChallenge.findFirst({
      where: {
        id: challengeId,
        purpose: "PLATFORM_ADMIN_STEP_UP",
      },
      include: { user: { include: { platformAdmin: true } } },
    });
    const platformAdmin = challenge?.user?.platformAdmin;
    if (
      !challenge ||
      !challenge.user ||
      !platformAdmin ||
      platformAdmin.status !== "ACTIVE" ||
      challenge.verifiedAt ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.attempts >= 5
    ) {
      throw new UnauthorizedException("Platform verification expired");
    }
    const context: AdminContext = { admin: platformAdmin, user: challenge.user };
    await this.assertWhatsappPermitted(context.admin.id);
    const attempt = await this.prisma.ownerOtpChallenge.updateMany({
      where: {
        id: challenge.id,
        userId: context.user.id,
        verifiedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: 5 },
      },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count !== 1) {
      throw new UnauthorizedException("Platform verification expired");
    }
    const approved = await this.otpProvider.verify(
      challenge.providerReference,
      challenge.phone,
      code,
    );
    if (!approved) {
      await this.prisma.platformAdminAuditLog.create({
        data: {
          actorAdminId: context.admin.id,
          action: "PLATFORM_ADMIN_STEP_UP_FAILED",
          targetType: "OwnerOtpChallenge",
          targetId: challenge.id,
          requestId: randomUUID(),
          ...this.sessionMeta(meta),
        },
      });
      throw new UnauthorizedException("Invalid verification code");
    }
    const generated = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const now = new Date();
    const platformSession = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.ownerOtpChallenge.updateMany({
        where: {
          id: challenge.id,
          userId: context.user.id,
          verifiedAt: null,
          expiresAt: { gt: now },
        },
        data: { verifiedAt: now },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException("Platform verification already used");
      }
      const session = await tx.platformAdminSession.create({
        data: {
          platformAdminId: context.admin.id,
          tokenHash: generated.tokenHash,
          authenticationMethod: "WHATSAPP_OTP",
          verifiedAt: now,
          expiresAt,
          ...this.sessionMeta(meta),
        },
      });
      await tx.platformAdminAuditLog.create({
        data: {
          actorAdminId: context.admin.id,
          action: "PLATFORM_ADMIN_STEP_UP",
          targetType: "PlatformAdminSession",
          targetId: session.id,
          requestId: randomUUID(),
          ...this.sessionMeta(meta),
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

  async passkeys(rawPlatformToken?: string) {
    this.assertPasskeysEnabled();
    const context = await this.platformAdminSession(rawPlatformToken, false);
    const [passkeys, remainingRecoveryCodes] = await Promise.all([
      this.prisma.platformAdminPasskey.findMany({
        where: { platformAdminId: context.admin.id },
        select: {
          id: true,
          backedUp: true,
          createdAt: true,
          deviceType: true,
          lastUsedAt: true,
          name: true,
          transports: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.platformAdminRecoveryCode.count({
        where: { platformAdminId: context.admin.id, usedAt: null },
      }),
    ]);
    return { passkeys, remainingRecoveryCodes };
  }

  async passkeyRegistrationOptions(
    rawPlatformToken?: string,
  ) {
    this.assertPasskeysEnabled();
    const context = await this.platformAdminSession(rawPlatformToken, true);
    const existing = await this.prisma.platformAdminPasskey.findMany({
      where: { platformAdminId: context.admin.id },
      select: { credentialId: true, transports: true },
    });
    const options = await generateRegistrationOptions({
      rpName: this.config.get<string>("WEBAUTHN_RP_NAME") || "Loyal Loop Admin",
      rpID: this.rpId(),
      userID: new TextEncoder().encode(context.user.id),
      userName: context.user.email,
      userDisplayName: context.user.name,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: existing.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
    });
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.platformAdminPasskeyChallenge.updateMany({
        where: {
          platformAdminId: context.admin.id,
          purpose: "REGISTRATION",
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      return tx.platformAdminPasskeyChallenge.create({
        data: {
          platformAdminId: context.admin.id,
          purpose: "REGISTRATION",
          challenge: options.challenge,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
    });
    return { challengeId: challenge.id, options };
  }

  async verifyPasskeyRegistration(
    rawPlatformToken: string | undefined,
    dto: VerifyPasskeyRegistrationDto,
  ) {
    this.assertPasskeysEnabled();
    const context = await this.platformAdminSession(rawPlatformToken, true);
    const challenge = await this.prisma.platformAdminPasskeyChallenge.findFirst({
      where: {
        id: dto.challengeId,
        platformAdminId: context.admin.id,
        purpose: "REGISTRATION",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!challenge) throw new UnauthorizedException("Passkey registration expired");
    const verification = await verifyRegistrationResponse({
      response: dto.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.rpOrigins(),
      expectedRPID: this.rpId(),
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException("Passkey registration could not be verified");
    }
    const info = verification.registrationInfo;
    const firstPasskey = await this.prisma.platformAdminPasskey.count({
      where: { platformAdminId: context.admin.id },
    }) === 0;
    const recoveryCodes = firstPasskey ? this.newRecoveryCodes() : [];
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.platformAdminPasskeyChallenge.updateMany({
        where: { id: challenge.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException("Passkey registration already used");
      }
      const passkey = await tx.platformAdminPasskey.create({
        data: {
          platformAdminId: context.admin.id,
          credentialId: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey),
          counter: BigInt(info.credential.counter),
          transports: dto.response.response.transports ?? [],
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          name: dto.name?.trim() || "Passkey",
        },
        select: {
          id: true,
          backedUp: true,
          createdAt: true,
          deviceType: true,
          lastUsedAt: true,
          name: true,
          transports: true,
        },
      });
      if (recoveryCodes.length) {
        await tx.platformAdminRecoveryCode.createMany({
          data: recoveryCodes.map((code) => ({
            platformAdminId: context.admin.id,
            codeHash: hashToken(code),
          })),
        });
      }
      await tx.platformAdminAuditLog.create({
        data: {
          actorAdminId: context.admin.id,
          action: "PLATFORM_ADMIN_PASSKEY_REGISTERED",
          targetType: "PlatformAdminPasskey",
          targetId: passkey.id,
        },
      });
      return { passkey, recoveryCodes };
    });
  }

  async passkeyAuthenticationOptions(identifier: string) {
    this.assertPasskeysEnabled();
    const context = await this.adminByIdentifier(identifier);
    const passkeys = await this.prisma.platformAdminPasskey.findMany({
      where: { platformAdminId: context.admin.id },
      select: { credentialId: true, transports: true },
    });
    if (!passkeys.length) throw new NotFoundException("No passkeys are registered");
    const options = await generateAuthenticationOptions({
      rpID: this.rpId(),
      allowCredentials: passkeys.map((credential) => ({
        id: credential.credentialId,
        transports: credential.transports as AuthenticatorTransportFuture[],
      })),
      userVerification: "required",
    });
    const challenge = await this.prisma.$transaction(async (tx) => {
      await tx.platformAdminPasskeyChallenge.updateMany({
        where: {
          platformAdminId: context.admin.id,
          purpose: "AUTHENTICATION",
          usedAt: null,
        },
        data: { usedAt: new Date() },
      });
      return tx.platformAdminPasskeyChallenge.create({
        data: {
          platformAdminId: context.admin.id,
          purpose: "AUTHENTICATION",
          challenge: options.challenge,
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        },
      });
    });
    return { challengeId: challenge.id, options };
  }

  async verifyPasskeyAuthentication(
    dto: VerifyPasskeyAuthenticationDto,
    meta: PlatformSessionMeta = {},
  ) {
    this.assertPasskeysEnabled();
    const challenge = await this.prisma.platformAdminPasskeyChallenge.findFirst({
      where: {
        id: dto.challengeId,
        purpose: "AUTHENTICATION",
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { platformAdmin: { include: { user: true } } },
    });
    if (!challenge || challenge.platformAdmin.status !== "ACTIVE") {
      throw new UnauthorizedException("Passkey verification expired");
    }
    const context: AdminContext = {
      admin: challenge.platformAdmin,
      user: challenge.platformAdmin.user,
    };
    const passkey = await this.prisma.platformAdminPasskey.findFirst({
      where: {
        platformAdminId: context.admin.id,
        credentialId: dto.response.id,
      },
    });
    if (!passkey) throw new UnauthorizedException("Passkey verification expired");
    const verification = await verifyAuthenticationResponse({
      response: dto.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.rpOrigins(),
      expectedRPID: this.rpId(),
      credential: {
        id: passkey.credentialId,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: Number(passkey.counter),
        transports: passkey.transports as AuthenticatorTransportFuture[],
      },
      requireUserVerification: true,
    });
    if (!verification.verified) throw new UnauthorizedException("Passkey verification failed");
    const generated = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const now = new Date();
    const platformSession = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.platformAdminPasskeyChallenge.updateMany({
        where: { id: challenge.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new UnauthorizedException("Passkey verification already used");
      await tx.platformAdminPasskey.update({
        where: { id: passkey.id },
        data: {
          counter: BigInt(verification.authenticationInfo.newCounter),
          backedUp: verification.authenticationInfo.credentialBackedUp,
          deviceType: verification.authenticationInfo.credentialDeviceType,
          lastUsedAt: now,
        },
      });
      const session = await tx.platformAdminSession.create({
        data: {
          platformAdminId: context.admin.id,
          passkeyId: passkey.id,
          tokenHash: generated.tokenHash,
          authenticationMethod: "PASSKEY",
          verifiedAt: now,
          expiresAt,
          ...this.sessionMeta(meta),
        },
      });
      await tx.platformAdminAuditLog.create({
        data: {
          actorAdminId: context.admin.id,
          action: "PLATFORM_ADMIN_PASSKEY_STEP_UP",
          targetType: "PlatformAdminSession",
          targetId: session.id,
          requestId: randomUUID(),
          ...this.sessionMeta(meta),
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

  async verifyRecoveryCode(
    rawCode: string,
    meta: PlatformSessionMeta = {},
  ) {
    this.assertPasskeysEnabled();
    const code = rawCode.trim().toUpperCase();
    const recovery = await this.prisma.platformAdminRecoveryCode.findFirst({
      where: {
        codeHash: hashToken(code),
        usedAt: null,
      },
      include: { platformAdmin: { include: { user: true } } },
    });
    if (!recovery || recovery.platformAdmin.status !== "ACTIVE") {
      throw new UnauthorizedException("Recovery code is invalid or already used");
    }
    const context: AdminContext = {
      admin: recovery.platformAdmin,
      user: recovery.platformAdmin.user,
    };
    const generated = createOpaqueToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const now = new Date();
    const session = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.platformAdminRecoveryCode.updateMany({
        where: { id: recovery.id, platformAdminId: context.admin.id, usedAt: null },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new UnauthorizedException("Recovery code was already used");
      const created = await tx.platformAdminSession.create({
        data: {
          platformAdminId: context.admin.id,
          tokenHash: generated.tokenHash,
          authenticationMethod: "RECOVERY_CODE",
          verifiedAt: now,
          expiresAt,
          ...this.sessionMeta(meta),
        },
      });
      await tx.platformAdminAuditLog.create({
        data: {
          actorAdminId: context.admin.id,
          action: "PLATFORM_ADMIN_RECOVERY_CODE_USED",
          targetType: "PlatformAdminSession",
          targetId: created.id,
          requestId: randomUUID(),
          ...this.sessionMeta(meta),
        },
      });
      return created;
    });
    return {
      token: generated.token,
      expiresAt,
      platformSessionId: session.id,
      admin: this.publicAdmin(context, false),
    };
  }

  async regenerateRecoveryCodes(rawPlatformToken?: string) {
    this.assertPasskeysEnabled();
    const context = await this.platformAdminSession(rawPlatformToken, true);
    const codes = this.newRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.platformAdminRecoveryCode.deleteMany({ where: { platformAdminId: context.admin.id } });
      await tx.platformAdminRecoveryCode.createMany({
        data: codes.map((code) => ({ platformAdminId: context.admin.id, codeHash: hashToken(code) })),
      });
      await tx.platformAdminAuditLog.create({
        data: {
          actorAdminId: context.admin.id,
          action: "PLATFORM_ADMIN_RECOVERY_CODES_REGENERATED",
          targetType: "PlatformAdmin",
          targetId: context.admin.id,
        },
      });
    });
    return { recoveryCodes: codes };
  }

  async renamePasskey(
    rawPlatformToken: string | undefined,
    id: string,
    name: string,
  ) {
    this.assertPasskeysEnabled();
    const context = await this.platformAdminSession(rawPlatformToken, false);
    const updated = await this.prisma.platformAdminPasskey.updateMany({
      where: { id, platformAdminId: context.admin.id },
      data: { name: name.trim() },
    });
    if (updated.count !== 1) throw new NotFoundException("Passkey not found");
    return { id, name: name.trim() };
  }

  async removePasskey(
    rawPlatformToken: string | undefined,
    id: string,
  ) {
    this.assertPasskeysEnabled();
    const context = await this.platformAdminSession(rawPlatformToken, true);
    return this.prisma.$transaction(async (tx) => {
      const passkey = await tx.platformAdminPasskey.findFirst({ where: { id, platformAdminId: context.admin.id } });
      if (!passkey) throw new NotFoundException("Passkey not found");
      await tx.platformAdminSession.updateMany({
        where: { passkeyId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.platformAdminPasskey.delete({ where: { id } });
      await tx.platformAdminAuditLog.create({
        data: {
          actorAdminId: context.admin.id,
          action: "PLATFORM_ADMIN_PASSKEY_REMOVED",
          targetType: "PlatformAdminPasskey",
          targetId: id,
        },
      });
      return { id };
    });
  }

  async logout(rawPlatformToken?: string) {
    this.assertEnabled();
    if (!rawPlatformToken) return;
    await this.prisma.platformAdminSession.updateMany({
      where: { tokenHash: hashToken(rawPlatformToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async adminByIdentifier(identifier: string): Promise<AdminContext> {
    const value = identifier.trim();
    let where: { email?: string; phone?: string };
    if (value.includes("@")) {
      where = { email: value.toLowerCase() };
    } else {
      const digits = value.replace(/\D/g, "");
      const candidate = digits.length === 11 && digits.startsWith("0")
        ? `+234${digits.slice(1)}`
        : value;
      try {
        where = { phone: normalizeE164(candidate) };
      } catch {
        throw new UnauthorizedException("Admin sign-in could not be started");
      }
    }
    const user = await this.prisma.user.findFirst({
      where,
      include: { platformAdmin: true },
    });
    if (!user || user.platformAdmin?.status !== "ACTIVE") {
      throw new UnauthorizedException("Admin sign-in could not be started");
    }
    return { admin: user.platformAdmin, user };
  }

  private async platformAdminSession(
    rawPlatformToken?: string,
    recent = false,
  ) {
    if (!rawPlatformToken) throw new UnauthorizedException("Platform step-up verification required");
    const session = await this.prisma.platformAdminSession.findUnique({
      where: { tokenHash: hashToken(rawPlatformToken) },
      include: { platformAdmin: { include: { user: true } } },
    });
    if (
      !session ||
      session.platformAdmin.status !== "ACTIVE" ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      Date.now() - session.lastUsedAt.getTime() > 30 * 60 * 1000 ||
      (recent && Date.now() - session.verifiedAt.getTime() > 10 * 60 * 1000)
    ) {
      throw new UnauthorizedException("Recent platform step-up verification required");
    }
    return {
      platformSession: session,
      admin: session.platformAdmin,
      user: session.platformAdmin.user,
    };
  }

  private assertEnabled() {
    if (this.config.get<string>("ADMIN_PORTAL_ENABLED", "false") !== "true") {
      throw new NotFoundException("Platform administration is not available");
    }
  }

  private assertPasskeysEnabled() {
    this.assertEnabled();
    if (this.config.get<string>("ADMIN_PASSKEY_ENABLED", "false") !== "true") {
      throw new NotFoundException("Platform passkeys are not available");
    }
  }

  private async assertWhatsappPermitted(platformAdminId: string) {
    if (
      this.config.get<string>("ADMIN_WHATSAPP_FALLBACK_ENABLED", "true") !==
      "true"
    ) {
      throw new NotFoundException("WhatsApp admin verification is disabled");
    }
    if (this.config.get<string>("ADMIN_PASSKEY_REQUIRED", "false") === "true") {
      const passkeys = await this.prisma.platformAdminPasskey.count({
        where: { platformAdminId },
      });
      if (passkeys > 0) {
        throw new ForbiddenException("Use a passkey or recovery code for platform administration");
      }
    }
  }

  private rpId() {
    const value = this.config.get<string>("ADMIN_WEBAUTHN_RP_ID");
    if (!value) throw new NotFoundException("Platform passkeys are not configured");
    return value;
  }

  private rpOrigins() {
    const values = (this.config.get<string>("ADMIN_WEBAUTHN_ORIGINS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!values.length) throw new NotFoundException("Platform passkeys are not configured");
    return values;
  }

  private sessionMeta(meta: PlatformSessionMeta) {
    return {
      userAgent: meta.userAgent,
      ipHash: meta.ip
        ? hmacPrivateValue(
            meta.ip,
            this.config.get<string>("SESSION_HASH_SECRET") || "development-admin-session-secret",
          )
        : undefined,
    };
  }

  private newRecoveryCodes() {
    return Array.from({ length: 10 }, () => {
      const value = randomBytes(8).toString("hex").toUpperCase();
      return `LL-${value.slice(0, 8)}-${value.slice(8)}`;
    });
  }

  private publicAdmin(
    context: AdminContext,
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
      passkeysEnabled:
        this.config.get<string>("ADMIN_PASSKEY_ENABLED", "false") === "true",
    };
  }
}
