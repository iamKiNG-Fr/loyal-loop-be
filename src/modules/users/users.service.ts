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
    try {
      return await this.prisma.user.update({
        where: { id: auth.userId },
        data: {
          avatarAssetId: dto.avatarAssetId,
          name: dto.name?.trim(),
          email: dto.email?.trim().toLowerCase(),
          phone: dto.phone?.trim(),
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
