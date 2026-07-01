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

  getCurrent(auth: OwnerAuthContext) {
    return this.prisma.business.findUniqueOrThrow({
      where: { id: auth.businessId },
      include: {
        logoAsset: true,
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
    const business = await this.prisma.business.findUnique({
      where: { publicCardId: cardId.trim().toUpperCase() },
      select: {
        publicCardId: true,
        name: true,
        slug: true,
        storeStatus: true,
      },
    });
    if (!business || business.storeStatus !== "OPEN") {
      throw new NotFoundException("Trust Card is unavailable");
    }
    return {
      active: true,
      businessName: business.name,
      cardId: business.publicCardId,
      shopSlug: business.slug,
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
