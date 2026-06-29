import { Injectable } from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { PrismaService } from "../prisma/prisma.service";
import { CreateSupportRequestDto } from "./dto/support.dto";

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  create(auth: OwnerAuthContext, dto: CreateSupportRequestDto) {
    return this.prisma.supportRequest.create({
      data: {
        businessId: auth.businessId,
        topic: dto.topic.trim(),
        message: dto.message.trim(),
      },
    });
  }

  list(auth: OwnerAuthContext) {
    return this.prisma.supportRequest.findMany({
      where: { businessId: auth.businessId },
      orderBy: { createdAt: "desc" },
    });
  }
}
