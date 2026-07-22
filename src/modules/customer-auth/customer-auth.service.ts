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
import { normalizeE164 } from "../messaging/twilio-whatsapp.provider";
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from "./dto/customer-address.dto";
import { OTP_PROVIDER, type OtpProvider } from "./otp-provider";
import { UpdateCustomerProfileDto } from "./dto/customer-profile.dto";

const customerProfileSelect = {
  id: true,
  name: true,
  phone: true,
  alternatePhone: true,
  birthday: true,
  gender: true,
  socials: true,
  verifiedAt: true,
} as const;

@Injectable()
export class CustomerAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
  ) {}

  async start(phone: string) {
    const normalizedPhone = normalizeE164(phone);
    const started = await this.provider.start(normalizedPhone);
    const challenge = await this.prisma.customerOtpChallenge.create({
      data: {
        phone: normalizedPhone,
        provider: started.provider,
        providerReference: started.reference,
        expiresAt: started.expiresAt,
      },
    });
    return {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
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

  getAccount(customerAccountId: string) {
    return this.prisma.customerAccount.findUniqueOrThrow({
      where: { id: customerAccountId },
      select: customerProfileSelect,
    });
  }

  updateProfile(customerAccountId: string, dto: UpdateCustomerProfileDto) {
    const socials = dto.socials
      ? Object.fromEntries(Object.entries(dto.socials)
          .map(([platform, value]) => [platform.slice(0, 30), String(value).trim().slice(0, 160)])
          .filter(([, value]) => Boolean(value)))
      : undefined;
    return this.prisma.customerAccount.update({
      where: { id: customerAccountId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.alternatePhone !== undefined ? { alternatePhone: dto.alternatePhone.trim() || null } : {}),
        ...(dto.birthday !== undefined ? { birthday: dto.birthday ? new Date(`${dto.birthday.slice(0, 10)}T00:00:00.000Z`) : null } : {}),
        ...(dto.gender !== undefined ? { gender: dto.gender.trim() || null } : {}),
        ...(socials !== undefined ? { socials } : {}),
      },
      select: customerProfileSelect,
    });
  }

  listAddresses(customerAccountId: string) {
    return this.prisma.customerAddress.findMany({
      where: { customerAccountId },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
  }

  listOrders(customerAccountId: string) {
    return this.prisma.orderRequest.findMany({
      where: { customerAccountId },
      include: {
        business: { select: { name: true, slug: true } },
        items: true,
        termChanges: { orderBy: { createdAt: "desc" }, take: 5 },
        sourceShowcase: {
          select: {
            id: true,
            title: true,
            asset: { select: { secureUrl: true } },
          },
        },
        convertedSale: {
          select: {
            delivery: { select: { id: true, status: true } },
            paymentStatus: true,
            referenceCode: true,
          },
        },
        customerNotices: {
          where: { readAt: null },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async orderNoticeSummary(customerAccountId: string) {
    const [unreadCount, actionRequiredCount, recent] = await this.prisma.$transaction([
      this.prisma.customerOrderNotice.count({ where: { customerAccountId, readAt: null } }),
      this.prisma.customerOrderNotice.count({ where: { customerAccountId, actionRequired: true, actionResolvedAt: null } }),
      this.prisma.customerOrderNotice.findMany({
        where: { customerAccountId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, message: true, orderRequestId: true, type: true, actionRequired: true, readAt: true, createdAt: true },
      }),
    ]);
    return { actionRequiredCount, recent, unreadCount };
  }

  async markOrderNoticesRead(customerAccountId: string) {
    const result = await this.prisma.customerOrderNotice.updateMany({
      where: { customerAccountId, readAt: null },
      data: { readAt: new Date() },
    });
    return { read: result.count };
  }

  async createOrderLink(customerAccountId: string, requestId: string) {
    const request = await this.prisma.orderRequest.findFirst({
      where: { id: requestId, customerAccountId },
      include: { convertedSale: { include: { delivery: true } } },
    });
    if (!request) throw new NotFoundException("Order not found");
    const delivery = request.convertedSale?.delivery;
    const generated = createOpaqueToken();
    if (delivery) {
      await this.prisma.deliveryShareToken.create({
        data: { deliveryId: delivery.id, tokenHash: generated.tokenHash },
      });
      return { kind: "delivery" as const, token: generated.token };
    }
    await this.prisma.orderRequestShareToken.create({
      data: { orderRequestId: request.id, tokenHash: generated.tokenHash },
    });
    return { kind: "request" as const, token: generated.token };
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
    countryCode: dto.countryCode?.trim().toUpperCase(),
    administrativeArea1: dto.administrativeArea1?.trim(),
    locality: dto.locality?.trim(),
    deliveryNotes: dto.deliveryNotes?.trim(),
  };
}
