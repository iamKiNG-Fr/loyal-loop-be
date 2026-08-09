import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateUserDto } from "./dto/user.dto";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async update(auth: OwnerAuthContext, dto: UpdateUserDto) {
    if (dto.avatarAssetId) {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: {
          id: dto.avatarAssetId,
          businessId: auth.businessId,
          purpose: "USER_AVATAR",
          status: "ACTIVE",
        },
      });
      if (!asset) throw new BadRequestException("Profile image asset is invalid");
    }
    let emailChanged = false;
    if (dto.phone !== undefined || dto.email !== undefined) {
      const current = await this.prisma.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: { email: true, phone: true },
      });
      if (
        dto.phone !== undefined &&
        comparablePhone(dto.phone) !== comparablePhone(current.phone || "")
      ) {
        throw new BadRequestException(
          "Change and verify the business WhatsApp number under Socials and business number",
        );
      }
      emailChanged =
        dto.email !== undefined &&
        dto.email.trim().toLowerCase() !== current.email;
    }
    try {
      return await this.prisma.user.update({
        where: { id: auth.userId },
        data: {
          avatarAssetId: dto.avatarAssetId,
          name: dto.name?.trim(),
          email: dto.email?.trim().toLowerCase(),
          emailVerifiedAt: emailChanged ? null : undefined,
          workspaceAppearance: dto.workspaceAppearance,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          workspaceAppearance: true,
          avatarAsset: {
            select: { id: true, secureUrl: true },
          },
          updatedAt: true,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("Email is already in use");
      }
      throw error;
    }
  }
}

function comparablePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}
