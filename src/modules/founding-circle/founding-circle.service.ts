import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { Prisma } from "../../generated/prisma/client";
import { normalizeE164 } from "../messaging/twilio-whatsapp.provider";
import { MessagingService } from "../messaging/messaging.service";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateFoundingApplicationDto,
  CreateFoundingInvitationDto,
} from "./dto/founding-circle.dto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

type GrantPayload = { expiresAt: number; invitationId: string };

@Injectable()
export class FoundingCircleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly messaging: MessagingService,
  ) {}

  accessRequired() {
    return this.config.get<string>("FOUNDING_ACCESS_REQUIRED", "false") === "true";
  }

  async createApplication(dto: CreateFoundingApplicationDto) {
    if (!dto.whatsappConsent) {
      throw new BadRequestException(
        "Please agree to receive Founding Circle access updates on WhatsApp",
      );
    }
    const phone = normalizeE164(dto.phone);
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.foundingAccessApplication.findFirst({
      where: { OR: [{ email }, { phone }] },
    });
    if (existing) {
      if (!existing.phone && existing.email === email) {
        await this.prisma.foundingAccessApplication.update({
          where: { id: existing.id },
          data: {
            phone,
            whatTheySell: dto.whatTheySell.trim(),
            primarySellingChannel: dto.primarySellingChannel,
            whatsappConsentAt: new Date(),
            whatsappConsentSource: "homepage-request",
          },
        });
      }
      await this.messaging.grantFoundingAccessConsent(phone, "homepage-request");
      return { applicationId: existing.id, received: true };
    }
    let application: { id: string };
    try {
      application = await this.prisma.foundingAccessApplication.create({
        data: {
          ownerName: dto.ownerName.trim(),
          businessName: dto.businessName.trim(),
          email,
          phone,
          whatTheySell: dto.whatTheySell.trim(),
          primarySellingChannel: dto.primarySellingChannel,
          whatsappConsentAt: new Date(),
          whatsappConsentSource: "homepage-request",
        },
      });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) {
        throw error;
      }
      const raced = await this.prisma.foundingAccessApplication.findFirst({
        where: { OR: [{ email }, { phone }] },
        select: { id: true },
      });
      if (!raced) throw error;
      application = raced;
    }
    await this.messaging.grantFoundingAccessConsent(phone, "homepage-request");
    return { applicationId: application.id, received: true };
  }

  async grantApplicationConsent(phone: string, source: string) {
    await this.messaging.grantFoundingAccessConsent(phone, source);
  }

  async validateAccess(rawCode: string) {
    if (!this.accessRequired()) {
      return {
        grantToken: this.signGrant({ invitationId: "access-not-required", expiresAt: Date.now() + 86_400_000 }),
        expiresAt: new Date(Date.now() + 86_400_000),
        invitationSuffix: "OPEN",
        draftScope: null,
      };
    }
    const normalized = normalizeInvitationCode(rawCode);
    const invitation = await this.prisma.onboardingInvitation.findUnique({
      where: { codeHash: this.codeHash(normalized) },
    });
    if (
      !invitation ||
      invitation.status !== "ISSUED" ||
      invitation.useCount >= invitation.maxUses ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      if (invitation?.status === "ISSUED" && invitation.expiresAt.getTime() <= Date.now()) {
        await this.prisma.onboardingInvitation.update({
          where: { id: invitation.id },
          data: { status: "EXPIRED" },
        });
      }
      throw new UnauthorizedException("That invitation is invalid or expired");
    }
    await this.prisma.onboardingInvitation.update({
      where: { id: invitation.id },
      data: { validatedAt: new Date() },
    });
    const expiresAt = new Date(
      Math.min(invitation.expiresAt.getTime(), Date.now() + 24 * 60 * 60 * 1000),
    );
    return {
      grantToken: this.signGrant({ invitationId: invitation.id, expiresAt: expiresAt.getTime() }),
      expiresAt,
      invitationSuffix: invitation.codeSuffix,
      draftScope: this.draftScope(invitation.id),
    };
  }

  async grantStatus(rawGrant?: string) {
    if (!this.accessRequired()) {
      return { required: false, valid: true, expiresAt: null, invitationSuffix: null, draftScope: null };
    }
    if (!rawGrant) return { required: true, valid: false, expiresAt: null, invitationSuffix: null, draftScope: null };
    try {
      const payload = this.verifyGrant(rawGrant);
      const invitation = await this.prisma.onboardingInvitation.findUnique({
        where: { id: payload.invitationId },
        select: { status: true, expiresAt: true, codeSuffix: true },
      });
      const valid = Boolean(
        invitation &&
          invitation.status === "ISSUED" &&
          invitation.expiresAt.getTime() > Date.now(),
      );
      return {
        required: true,
        valid,
        expiresAt: valid ? new Date(payload.expiresAt) : null,
        invitationSuffix: valid ? invitation!.codeSuffix : null,
        draftScope: valid ? this.draftScope(payload.invitationId) : null,
      };
    } catch {
      return { required: true, valid: false, expiresAt: null, invitationSuffix: null, draftScope: null };
    }
  }

  resolveRegistrationGrant(rawGrant?: string) {
    if (!this.accessRequired() && !rawGrant) return null;
    if (!rawGrant) {
      throw new ForbiddenException({
        error: "FOUNDING_ACCESS_REQUIRED",
        message: "A valid Founding Circle invitation is required to create a business",
      });
    }
    const payload = this.verifyGrant(rawGrant);
    return payload.invitationId === "access-not-required" ? null : payload;
  }

  async redeemInTransaction(
    tx: Prisma.TransactionClient,
    grant: GrantPayload | null,
    input: { businessId: string; email: string; phone: string; userId: string },
  ) {
    if (!grant) return;
    const invitation = await tx.onboardingInvitation.findUnique({
      where: { id: grant.invitationId },
    });
    const phone = normalizeE164(input.phone);
    if (
      !invitation ||
      invitation.status !== "ISSUED" ||
      invitation.expiresAt.getTime() <= Date.now() ||
      invitation.useCount >= invitation.maxUses
    ) {
      throw new ConflictException("This invitation is no longer available");
    }
    if (invitation.phone !== phone) {
      throw new ForbiddenException({
        error: "INVITATION_PHONE_MISMATCH",
        message: "Verify the WhatsApp number that received this invitation",
      });
    }
    const claimed = await tx.onboardingInvitation.updateMany({
      where: {
        id: invitation.id,
        status: "ISSUED",
        useCount: { lt: invitation.maxUses },
        expiresAt: { gt: new Date() },
      },
      data: {
        status: "REDEEMED",
        useCount: { increment: 1 },
        redeemedAt: new Date(),
        redeemedByUserId: input.userId,
        resultingBusinessId: input.businessId,
        encryptedToken: null,
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException("This invitation was already redeemed");
    }
    await tx.foundingProgramEnrollment.create({
      data: {
        businessId: input.businessId,
        invitationId: invitation.id,
        cohortId: invitation.cohortId,
        invitedAt: invitation.createdAt,
      },
    });
    if (invitation.applicationId) {
      await tx.foundingAccessApplication.update({
        where: { id: invitation.applicationId },
        data: { status: "INVITED" },
      });
    }
  }

  async createInvitation(adminId: string, dto: CreateFoundingInvitationDto) {
    if (!dto.consentAttested) {
      throw new BadRequestException(
        "Confirm that this person asked to receive their invitation on WhatsApp",
      );
    }
    const phone = normalizeE164(dto.phone);
    const active = await this.prisma.onboardingInvitation.findFirst({
      where: { phone, status: "ISSUED", expiresAt: { gt: new Date() } },
    });
    if (active) throw new ConflictException("This WhatsApp number already has an active invitation");

    const code = createInvitationCode();
    const normalized = normalizeInvitationCode(code);
    const expiresAt = new Date(Date.now() + (dto.expiresInDays ?? 7) * 86_400_000);
    const appUrl = this.config
      .get<string>("APP_URL", "https://www.useloyalloop.com")
      .replace(/\/$/, "");
    const inviteUrl = `${appUrl}/join#invite=${encodeURIComponent(code)}`;
    const invitation = await this.prisma.onboardingInvitation.create({
      data: {
        applicationId: dto.applicationId,
        cohortId: dto.cohortId,
        codeHash: this.codeHash(normalized),
        codeSuffix: normalized.slice(-4),
        encryptedToken: this.encrypt(code),
        recipientName: dto.recipientName.trim(),
        businessName: dto.businessName.trim(),
        phone,
        email: dto.email?.trim().toLowerCase(),
        expiresAt,
        createdByAdminId: adminId,
      },
    });

    await this.messaging.grantFoundingAccessConsent(phone, "admin-attested-request");
    let delivery: { id: string; status: string } | null = null;
    if (dto.sendWhatsapp !== false) {
      delivery = await this.messaging.enqueueFoundingAccess({
        invitationId: invitation.id,
        phone,
        recipientName: invitation.recipientName,
        businessName: invitation.businessName,
        expiresAt,
      });
      await this.prisma.onboardingInvitation.update({
        where: { id: invitation.id },
        data: {
          messageOutboxId: delivery.id,
          ...(delivery.status === "SUPPRESSED" ? { encryptedToken: null } : {}),
        },
      });
      this.messaging.startFoundingAccessDelivery(delivery.id);
    } else {
      await this.prisma.onboardingInvitation.update({
        where: { id: invitation.id },
        data: { encryptedToken: null },
      });
    }
    if (dto.applicationId) {
      await this.prisma.foundingAccessApplication.update({
        where: { id: dto.applicationId },
        data: { status: "INVITED", reviewedAt: new Date(), reviewedByAdminId: adminId },
      });
    }
    return {
      invitation: this.safeInvitation(invitation),
      code,
      inviteUrl,
      whatsappMessage: foundingInviteMessage(
        invitation.recipientName,
        invitation.businessName,
        inviteUrl,
        expiresAt,
      ),
      delivery,
    };
  }

  async decryptInvitationToken(invitationId: string) {
    const invitation = await this.prisma.onboardingInvitation.findUnique({
      where: { id: invitationId },
      select: { encryptedToken: true },
    });
    if (!invitation?.encryptedToken) {
      throw new BadRequestException("Invitation delivery token is no longer available");
    }
    return this.decrypt(invitation.encryptedToken);
  }

  safeInvitation<T extends Record<string, unknown>>(invitation: T) {
    const { codeHash: _codeHash, encryptedToken: _encryptedToken, ...safe } = invitation;
    return safe;
  }

  private codeHash(code: string) {
    return createHmac("sha256", this.hashSecret()).update(code).digest("hex");
  }

  private draftScope(invitationId: string) {
    return createHmac("sha256", this.grantSecret())
      .update(`draft:${invitationId}`)
      .digest("base64url")
      .slice(0, 20);
  }

  private signGrant(payload: GrantPayload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.grantSecret()).update(encoded).digest("base64url");
    return `${encoded}.${signature}`;
  }

  private verifyGrant(raw: string): GrantPayload {
    const [encoded, signature] = raw.split(".");
    if (!encoded || !signature) throw new UnauthorizedException("Founding access expired");
    const expected = createHmac("sha256", this.grantSecret()).update(encoded).digest("base64url");
    if (!safeEqual(signature, expected)) throw new UnauthorizedException("Founding access expired");
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GrantPayload;
    if (!payload.invitationId || payload.expiresAt <= Date.now()) {
      throw new UnauthorizedException("Founding access expired");
    }
    return payload;
  }

  private encrypt(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted]
      .map((part) => part.toString("base64url"))
      .join(".");
  }

  private decrypt(value: string) {
    const [iv, tag, encrypted] = value.split(".").map((part) => Buffer.from(part, "base64url"));
    if (!iv || !tag || !encrypted) throw new BadRequestException("Invitation delivery token is invalid");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  private encryptionKey() {
    return createHash("sha256").update(this.encryptionSecret()).digest();
  }

  private hashSecret() {
    return this.config.get<string>("FOUNDING_INVITATION_HASH_SECRET") || this.grantSecret();
  }

  private grantSecret() {
    const value = this.config.get<string>("FOUNDING_GRANT_SECRET") || this.config.get<string>("SESSION_HASH_SECRET");
    if (!value) throw new Error("FOUNDING_GRANT_SECRET is required");
    return value;
  }

  private encryptionSecret() {
    const value = this.config.get<string>("FOUNDING_INVITATION_ENCRYPTION_KEY") || this.grantSecret();
    if (!value) throw new Error("FOUNDING_INVITATION_ENCRYPTION_KEY is required");
    return value;
  }
}

export function normalizeInvitationCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function createInvitationCode() {
  let value = "";
  for (const byte of randomBytes(12)) value += CODE_ALPHABET[byte & 31];
  return `LL-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

export function foundingInviteMessage(
  recipientName: string,
  businessName: string,
  inviteUrl: string,
  expiresAt: Date,
) {
  return `Hi ${recipientName} 👋 ${businessName} has been invited to the Loyal Loop Founding Circle. Start your business setup before ${expiresAt.toLocaleDateString("en-NG")}: ${inviteUrl}`;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
