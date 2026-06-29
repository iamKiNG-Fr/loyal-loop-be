import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createOpaqueToken, hashToken } from "../../common/crypto.util";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from "./dto/customer-address.dto";
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

  listAddresses(customerAccountId: string) {
    return this.prisma.customerAddress.findMany({
      where: { customerAccountId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
  }

  async createAddress(customerAccountId: string, dto: CreateCustomerAddressDto) {
    const shouldDefault =
      dto.isDefault ||
      (await this.prisma.customerAddress.count({ where: { customerAccountId } })) === 0;
    return this.prisma.$transaction(async (tx) => {
      if (shouldDefault) {
        await tx.customerAddress.updateMany({
          where: { customerAccountId },
          data: { isDefault: false },
        });
      }
      return tx.customerAddress.create({
        data: {
          customerAccountId,
          ...addressData(dto),
          isDefault: shouldDefault,
        },
      });
    });
  }

  async updateAddress(
    customerAccountId: string,
    addressId: string,
    dto: UpdateCustomerAddressDto,
  ) {
    const existing = await this.prisma.customerAddress.findFirst({
      where: { id: addressId, customerAccountId },
    });
    if (!existing) throw new NotFoundException("Address not found");
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerAccountId, id: { not: addressId } },
          data: { isDefault: false },
        });
      }
      return tx.customerAddress.update({
        where: { id: addressId },
        data: {
          ...addressData(dto),
          ...(typeof dto.isDefault === "boolean"
            ? { isDefault: dto.isDefault }
            : {}),
        },
      });
    });
  }

  async deleteAddress(customerAccountId: string, addressId: string) {
    const deleted = await this.prisma.customerAddress.deleteMany({
      where: { id: addressId, customerAccountId },
    });
    if (!deleted.count) throw new NotFoundException("Address not found");
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

function addressData(
  dto: CreateCustomerAddressDto | UpdateCustomerAddressDto,
) {
  return {
    label: dto.label?.trim(),
    recipientName: dto.recipientName?.trim(),
    phone: dto.phone?.trim(),
    address: dto.address?.trim(),
    googlePlaceId: dto.googlePlaceId?.trim(),
    latitude: dto.latitude,
    longitude: dto.longitude,
    deliveryNotes: dto.deliveryNotes?.trim(),
  };
}
