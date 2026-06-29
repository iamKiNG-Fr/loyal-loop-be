import { Injectable, NotFoundException } from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { ActivityService } from "../activity/activity.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateFollowUpSuggestionDto,
  CreateFollowUpTemplateDto,
} from "./dto/follow-up.dto";

@Injectable()
export class FollowUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  listTemplates(auth: OwnerAuthContext) {
    return this.prisma.followUpTemplate.findMany({
      where: { OR: [{ businessId: auth.businessId }, { businessId: null }] },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
  }

  createTemplate(auth: OwnerAuthContext, dto: CreateFollowUpTemplateDto) {
    return this.prisma.followUpTemplate.create({
      data: {
        businessId: auth.businessId,
        name: dto.name.trim(),
        body: dto.body.trim(),
      },
    });
  }

  listSuggestions(auth: OwnerAuthContext) {
    return this.prisma.followUpSuggestion.findMany({
      where: { businessId: auth.businessId },
      include: { customer: true, template: true },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    });
  }

  async createSuggestion(
    auth: OwnerAuthContext,
    dto: CreateFollowUpSuggestionDto,
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, businessId: auth.businessId },
    });
    if (!customer) throw new NotFoundException("Customer not found");
    return this.prisma.followUpSuggestion.create({
      data: {
        businessId: auth.businessId,
        customerId: customer.id,
        templateId: dto.templateId,
        reason: dto.reason.trim(),
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
    });
  }

  async approve(auth: OwnerAuthContext, id: string) {
    await this.assertOwned(auth.businessId, id);
    return this.prisma.followUpSuggestion.update({
      where: { id },
      data: { status: "APPROVED", approvedAt: new Date() },
    });
  }

  async complete(auth: OwnerAuthContext, id: string) {
    const suggestion = await this.assertOwned(auth.businessId, id);
    if (suggestion.status === "COMPLETED") return suggestion;
    if (suggestion.status !== "APPROVED") {
      throw new NotFoundException("Approve this follow-up before completing it");
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.followUpSuggestion.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId: suggestion.customerId,
          type: "FOLLOW_UP_SENT",
          title: "Follow-up completed",
          description: suggestion.reason,
        },
        tx,
      );
      return updated;
    });
  }

  private async assertOwned(businessId: string, id: string) {
    const suggestion = await this.prisma.followUpSuggestion.findFirst({
      where: { id, businessId },
    });
    if (!suggestion) throw new NotFoundException("Follow-up not found");
    return suggestion;
  }
}
