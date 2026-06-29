import { Injectable, NotFoundException } from "@nestjs/common";
import { hashToken } from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { ActivityService } from "../activity/activity.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateReceiptIssueDto, UpdateReceiptDto } from "./dto/receipt.dto";

const receiptInclude = {
  business: {
    include: {
      logoAsset: true,
      contacts: { orderBy: { sortOrder: "asc" as const } },
      preferences: true,
    },
  },
  customer: true,
  sale: { include: { items: true, payments: true, delivery: true } },
};

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  list(auth: OwnerAuthContext) {
    return this.prisma.receipt.findMany({
      where: { businessId: auth.businessId },
      include: receiptInclude,
      orderBy: { createdAt: "desc" },
    });
  }

  get(auth: OwnerAuthContext, id: string) {
    return this.prisma.receipt.findFirstOrThrow({
      where: { id, businessId: auth.businessId },
      include: receiptInclude,
    });
  }

  async update(auth: OwnerAuthContext, id: string, dto: UpdateReceiptDto) {
    await this.assertOwned(auth.businessId, id);
    return this.prisma.receipt.update({
      where: { id },
      data: { theme: dto.theme, note: dto.note?.trim() },
      include: receiptInclude,
    });
  }

  async markSent(auth: OwnerAuthContext, id: string) {
    const receipt = await this.assertOwned(auth.businessId, id);
    if (receipt.sentAt) return this.get(auth, id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.receipt.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date() },
        include: receiptInclude,
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId: receipt.customerId,
          saleId: receipt.saleId,
          receiptId: receipt.id,
          type: "RECEIPT_SENT",
          title: `Shared receipt ${receipt.receiptCode}`,
        },
        tx,
      );
      return updated;
    });
  }

  async getPublic(token: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { tokenHash: hashToken(token) },
      include: receiptInclude,
    });
    if (!receipt || receipt.status === "VOID") {
      throw new NotFoundException("Receipt not found");
    }
    if (!receipt.viewedAt) {
      await this.prisma.$transaction(async (tx) => {
        await tx.receipt.update({
          where: { id: receipt.id },
          data: { viewedAt: new Date(), status: "VIEWED" },
        });
        await this.activity.record(
          {
            businessId: receipt.businessId,
            customerId: receipt.customerId,
            saleId: receipt.saleId,
            receiptId: receipt.id,
            type: "RECEIPT_VIEWED",
            title: `Receipt ${receipt.receiptCode} viewed`,
            awardTrust: false,
          },
          tx,
        );
      });
    }
    return sanitizePublicReceipt(receipt);
  }

  async acknowledge(token: string) {
    const receipt = await this.findByToken(token);
    if (receipt.acknowledgedAt) return { acknowledgedAt: receipt.acknowledgedAt };
    const acknowledgedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.receipt.update({
        where: { id: receipt.id },
        data: { acknowledgedAt },
      });
      await this.activity.record(
        {
          businessId: receipt.businessId,
          customerId: receipt.customerId,
          saleId: receipt.saleId,
          receiptId: receipt.id,
          type: "RECEIPT_ACKNOWLEDGED",
          title: `Receipt ${receipt.receiptCode} acknowledged`,
          awardTrust: false,
        },
        tx,
      );
    });
    return { acknowledgedAt };
  }

  async createIssue(token: string, dto: CreateReceiptIssueDto) {
    const receipt = await this.findByToken(token);
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.customerIssue.create({
        data: {
          businessId: receipt.businessId,
          customerId: receipt.customerId,
          saleId: receipt.saleId,
          receiptId: receipt.id,
          description: dto.description.trim(),
        },
      });
      await this.activity.record(
        {
          businessId: receipt.businessId,
          customerId: receipt.customerId,
          saleId: receipt.saleId,
          receiptId: receipt.id,
          type: "ISSUE_OPENED",
          title: `Issue opened for receipt ${receipt.receiptCode}`,
          awardTrust: false,
        },
        tx,
      );
      return issue;
    });
  }

  private async assertOwned(businessId: string, id: string) {
    const receipt = await this.prisma.receipt.findFirst({
      where: { id, businessId },
    });
    if (!receipt) throw new NotFoundException("Receipt not found");
    return receipt;
  }

  private async findByToken(token: string) {
    const receipt = await this.prisma.receipt.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!receipt || receipt.status === "VOID") {
      throw new NotFoundException("Receipt not found");
    }
    return receipt;
  }
}

function sanitizePublicReceipt(receipt: Awaited<ReturnType<ReceiptsService["get"]>>) {
  const { tokenHash: _tokenHash, ...safeReceipt } = receipt;
  return {
    ...safeReceipt,
    business: {
      id: receipt.business.id,
      name: receipt.business.name,
      slug: receipt.business.slug,
      description: receipt.business.description,
      location: receipt.business.location,
      logoAsset: receipt.business.logoAsset,
      contacts: receipt.business.contacts,
      theme: receipt.business.preferences?.theme,
    },
  };
}
