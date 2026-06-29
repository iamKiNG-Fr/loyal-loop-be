import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createOpaqueToken, hashToken } from "../../common/crypto.util";
import { PrismaService } from "../prisma/prisma.service";
import { OTP_PROVIDER, type OtpProvider } from "./otp-provider";

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
  ) {}

  async start(phone: string) {
    const started = await this.provider.start(phone);
    const challenge = await this.prisma.customerOtpChallenge.create({
      data: {
        phone,
        provider: started.provider,
        providerReference: started.reference,
        expiresAt: started.expiresAt,
      },
    });
    return {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
      ...(started.provider === "development"
        ? { developmentCode: started.reference.split(":")[2] }
        : {}),
    };
  }

  async verify(challengeId: string, code: string) {
    const challenge = await this.prisma.customerOtpChallenge.findUnique({
      where: { id: challengeId },
    });
    if (
      !challenge ||
      challenge.verifiedAt ||
      challenge.expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException("Verification challenge expired");
    }
    if (challenge.attempts >= 5) {
      throw new BadRequestException("Too many verification attempts");
    }
    await this.prisma.customerOtpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    const approved = await this.provider.verify(
      challenge.providerReference,
      challenge.phone,
      code,
    );
    if (!approved) throw new BadRequestException("Invalid verification code");

    const account = await this.prisma.customerAccount.upsert({
      where: { phone: challenge.phone },
      create: { phone: challenge.phone, verifiedAt: new Date() },
      update: { verifiedAt: new Date() },
    });
    await this.prisma.customerOtpChallenge.update({
      where: { id: challenge.id },
      data: { verifiedAt: new Date(), customerAccountId: account.id },
    });
    const session = await this.createSession(account.id);
    return { account, session };
  }

  async rotate(rawToken: string) {
    const existing = await this.prisma.customerAccountSession.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (
      !existing ||
      existing.revokedAt ||
      existing.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("Customer session expired");
    }
    const generated = createOpaqueToken();
    const expiresAt = this.expiry();
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.customerAccountSession.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new UnauthorizedException("Customer session was already refreshed");
      }
      await tx.customerAccountSession.create({
        data: {
          customerAccountId: existing.customerAccountId,
          tokenHash: generated.tokenHash,
          expiresAt,
        },
      });
    });
    return { token: generated.token, expiresAt };
  }

  async logout(sessionId: string) {
    await this.prisma.customerAccountSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createSession(customerAccountId: string) {
    const generated = createOpaqueToken();
    const expiresAt = this.expiry();
    const session = await this.prisma.customerAccountSession.create({
      data: { customerAccountId, tokenHash: generated.tokenHash, expiresAt },
    });
    return { id: session.id, token: generated.token, expiresAt };
  }

  private expiry() {
    const days = this.config.get<number>("CUSTOMER_SESSION_DAYS", 90);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}
