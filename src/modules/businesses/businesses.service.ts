import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createOpaqueToken, hashToken } from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  AcceptBusinessInvitationDto,
  CreateBusinessInvitationDto,
} from "./dto/business-invitation.dto";
import {
  OpenShopDto,
  ScheduleShopLaunchDto,
} from "./dto/shop-launch.dto";
import {
  OwnerPledgeDto,
  ReplaceBusinessContactsDto,
  UpdateBusinessDto,
  UpdateBusinessPreferencesDto,
} from "./dto/update-business.dto";

@Injectable()
export class BusinessesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getCurrent(auth: OwnerAuthContext) {
    await this.reconcileScheduledLaunch(auth.businessId);
    return this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      include: {
        logoAsset: true,
        launchProduct: {
          include: {
            images: {
              include: { asset: true },
              orderBy: { sortOrder: "asc" },
            },
          },
        },
        preferences: true,
        contacts: { orderBy: { sortOrder: "asc" } },
        members: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: "asc" },
        },
        invitations: {
          where: { acceptedAt: null, revokedAt: null },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  }

  async resolvePublicCard(cardId: string) {
    const candidate = await this.prisma.business.findUnique({
      where: { publicCardId: cardId.trim().toUpperCase() },
      select: { id: true },
    });
    if (candidate) await this.reconcileScheduledLaunch(candidate.id);
    const business = await this.prisma.business.findUnique({
      where: { publicCardId: cardId.trim().toUpperCase() },
      select: {
        publicCardId: true,
        name: true,
        slug: true,
        storeStatus: true,
      },
    });
    if (!business || business.storeStatus === "CLOSED") {
      throw new NotFoundException("Trust Card is unavailable");
    }
    return {
      active: business.storeStatus === "OPEN",
      businessName: business.name,
      cardId: business.publicCardId,
      shopSlug: business.slug,
      status: business.storeStatus,
    };
  }

  async update(auth: OwnerAuthContext, dto: UpdateBusinessDto) {
    if (dto.logoAssetId) {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: {
          id: dto.logoAssetId,
          businessId: auth.businessId,
          purpose: "BUSINESS_LOGO",
          status: "ACTIVE",
        },
      });
      if (!asset) throw new BadRequestException("Business logo asset is invalid");
    }
    try {
      return await this.prisma.business.update({
        where: { id: auth.businessId },
        data: {
          ...dto,
          name: dto.name?.trim(),
          description: dto.description?.trim(),
          location: dto.location?.trim(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Business link is already in use");
      }
      throw error;
    }
  }

  async scheduleLaunch(
    auth: OwnerAuthContext,
    dto: ScheduleShopLaunchDto,
  ) {
    const launchAt = new Date(dto.launchAt);
    if (launchAt.getTime() <= Date.now()) {
      throw new BadRequestException("Launch time must be in the future");
    }
    if (launchAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException("Launch time must be within one year");
    }
    if (!isValidTimeZone(dto.timezone)) {
      throw new BadRequestException("Launch timezone is invalid");
    }

    const current = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { storeStatus: true },
    });
    if (!["SETTING_UP", "SCHEDULED"].includes(current.storeStatus)) {
      throw new BadRequestException(
        "Only shops that are setting up can schedule a launch",
      );
    }

    if (dto.productId) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: dto.productId,
          businessId: auth.businessId,
          status: "ACTIVE",
          visibility: "PUBLIC",
        },
        select: { id: true },
      });
      if (!product) {
        throw new BadRequestException("Launch product is invalid");
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.update({
        where: { id: auth.businessId },
        data: {
          storeStatus: "SCHEDULED",
          launchAt,
          launchTimezone: dto.timezone,
          launchTemplate: dto.template,
          launchMessage: dto.message?.trim() || null,
          launchProductId: dto.productId || null,
          launchAutoOpen: dto.autoOpen ?? false,
          launchShareVersion: { increment: 1 },
        },
        include: {
          logoAsset: true,
          launchProduct: {
            include: {
              images: {
                include: { asset: true },
                orderBy: { sortOrder: "asc" },
              },
            },
          },
          preferences: true,
          contacts: { orderBy: { sortOrder: "asc" } },
        },
      });
      await tx.activityEvent.create({
        data: {
          businessId: auth.businessId,
          actorId: auth.userId,
          type:
            current.storeStatus === "SCHEDULED"
              ? "SHOP_LAUNCH_UPDATED"
              : "SHOP_LAUNCH_SCHEDULED",
          title:
            current.storeStatus === "SCHEDULED"
              ? "Shop launch updated"
              : "Shop launch scheduled",
          metadata: {
            launchAt: launchAt.toISOString(),
            timezone: dto.timezone,
            template: dto.template,
          },
        },
      });
      return business;
    });
  }

  async cancelLaunch(auth: OwnerAuthContext) {
    const current = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { storeStatus: true },
    });
    if (current.storeStatus !== "SCHEDULED") {
      throw new BadRequestException("This shop has no scheduled launch");
    }
    return this.prisma.business.update({
      where: { id: auth.businessId },
      data: {
        storeStatus: "SETTING_UP",
        launchAt: null,
        launchTimezone: null,
        launchMessage: null,
        launchProductId: null,
        launchAutoOpen: false,
        launchShareVersion: { increment: 1 },
      },
    });
  }

  async openShop(auth: OwnerAuthContext, dto: OpenShopDto) {
    const current = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { storeStatus: true, launchedAt: true },
    });
    if (current.storeStatus === "CLOSED") {
      throw new BadRequestException("A closed shop cannot be opened");
    }
    if (current.storeStatus === "OPEN") {
      return this.getCurrent(auth);
    }
    const ready = await this.hasOrderableProduct(auth.businessId);
    if (!ready && !dto.confirmEmpty) {
      throw new BadRequestException(
        "Confirm that you want to open without an available product",
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: auth.businessId },
        data: {
          storeStatus: "OPEN",
          launchedAt: current.launchedAt ?? now,
          launchAutoOpen: false,
          launchShareVersion: { increment: 1 },
        },
      });
      await tx.activityEvent.create({
        data: {
          businessId: auth.businessId,
          actorId: auth.userId,
          type: "SHOP_OPENED",
          title: "Shop opened",
        },
      });
    });
    return this.getCurrent(auth);
  }

  async pauseShop(auth: OwnerAuthContext) {
    const current = await this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      select: { storeStatus: true },
    });
    if (current.storeStatus !== "OPEN") {
      throw new BadRequestException("Only an open shop can be paused");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.business.update({
        where: { id: auth.businessId },
        data: { storeStatus: "PAUSED", launchShareVersion: { increment: 1 } },
      });
      await tx.activityEvent.create({
        data: {
          businessId: auth.businessId,
          actorId: auth.userId,
          type: "SHOP_PAUSED",
          title: "Shop paused",
        },
      });
    });
    return this.getCurrent(auth);
  }

  async reconcileScheduledLaunchBySlug(slug: string) {
    const business = await this.prisma.business.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (business) await this.reconcileScheduledLaunch(business.id);
  }

  async reconcileScheduledLaunch(businessId: string) {
    const current = await this.prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        storeStatus: true,
        launchAt: true,
        launchAutoOpen: true,
        launchedAt: true,
      },
    });
    if (
      !current ||
      current.storeStatus !== "SCHEDULED" ||
      !current.launchAutoOpen ||
      !current.launchAt ||
      current.launchAt.getTime() > Date.now()
    ) {
      return false;
    }
    if (!(await this.hasOrderableProduct(businessId))) return false;

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.business.updateMany({
        where: {
          id: businessId,
          storeStatus: "SCHEDULED",
          launchAutoOpen: true,
          launchAt: { lte: now },
        },
        data: {
          storeStatus: "OPEN",
          launchedAt: current.launchedAt ?? now,
          launchAutoOpen: false,
          launchShareVersion: { increment: 1 },
        },
      });
      if (claimed.count !== 1) return false;
      await tx.activityEvent.create({
        data: {
          businessId,
          type: "SHOP_OPENED",
          title: "Scheduled shop launch opened",
        },
      });
      return true;
    });
  }

  private async hasOrderableProduct(businessId: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        businessId,
        status: "ACTIVE",
        visibility: "PUBLIC",
        OR: [{ stockCount: null }, { stockCount: { gt: 0 } }],
      },
      select: { id: true },
    });
    return Boolean(product);
  }

  updatePreferences(
    auth: OwnerAuthContext,
    dto: UpdateBusinessPreferencesDto,
  ) {
    const data = {
      ...dto,
      tickerItems: dto.tickerItems
        ? [...new Set(dto.tickerItems.map((item) => item.trim()).filter(Boolean))]
        : undefined,
    };
    return this.prisma.businessPreferences.upsert({
      where: { businessId: auth.businessId },
      create: { businessId: auth.businessId, ...data },
      update: data,
    });
  }

  async replaceContacts(
    auth: OwnerAuthContext,
    dto: ReplaceBusinessContactsDto,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.businessContact.deleteMany({
        where: { businessId: auth.businessId },
      });
      if (dto.contacts.length) {
        await tx.businessContact.createMany({
          data: dto.contacts.map((contact, index) => ({
            businessId: auth.businessId,
            platform: contact.platform,
            value: contact.value.trim(),
            label: contact.label?.trim(),
            isPrimary: contact.isPrimary ?? index === 0,
            sortOrder: index,
          })),
        });
      }
    });
    return this.prisma.businessContact.findMany({
      where: { businessId: auth.businessId },
      orderBy: { sortOrder: "asc" },
    });
  }

  async pledge(auth: OwnerAuthContext, dto: OwnerPledgeDto) {
    return this.prisma.$transaction(async (tx) => {
      const business = await tx.business.update({
        where: { id: auth.businessId },
        data: { pledgeSignature: dto.signature.trim(), pledgedAt: new Date() },
      });
      await tx.activityEvent.create({
        data: {
          businessId: auth.businessId,
          actorId: auth.userId,
          type: "OWNER_PLEDGED",
          title: "Owner pledge completed",
        },
      });
      return business;
    });
  }

  async invite(auth: OwnerAuthContext, dto: CreateBusinessInvitationDto) {
    if (dto.role === "OWNER") {
      throw new BadRequestException("Ownership cannot be assigned by invitation");
    }
    const generated = createOpaqueToken();
    const invitation = await this.prisma.businessInvitation.create({
      data: {
        businessId: auth.businessId,
        invitedById: auth.userId,
        name: dto.name.trim(),
        email: dto.email.trim().toLowerCase(),
        role: dto.role,
        tokenHash: generated.tokenHash,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    const appUrl = this.config
      .get<string>("APP_URL", "https://www.useloyalloop.com")
      .replace(/\/$/, "");
    return {
      invitation,
      inviteUrl: `${appUrl}/auth/invitation?token=${encodeURIComponent(generated.token)}`,
    };
  }

  async accept(auth: OwnerAuthContext, dto: AcceptBusinessInvitationDto) {
    const invitation = await this.prisma.businessInvitation.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      include: { business: true },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      throw new NotFoundException("Invitation is invalid or expired");
    }
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
    });
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      throw new BadRequestException("Invitation belongs to a different email");
    }
    await this.prisma.$transaction([
      this.prisma.businessMember.upsert({
        where: {
          businessId_userId: {
            businessId: invitation.businessId,
            userId: auth.userId,
          },
        },
        create: {
          businessId: invitation.businessId,
          userId: auth.userId,
          role: invitation.role,
          status: "ACTIVE",
          invitedAt: invitation.createdAt,
          joinedAt: new Date(),
        },
        update: {
          role: invitation.role,
          status: "ACTIVE",
          joinedAt: new Date(),
        },
      }),
      this.prisma.businessInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      }),
    ]);
    return invitation.business;
  }
}

function isValidTimeZone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}
