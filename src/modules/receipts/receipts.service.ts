import { Injectable, NotFoundException } from "@nestjs/common";
import { createOpaqueToken, hashToken } from "../../common/crypto.util";
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
  sale: {
    include: {
      items: true,
      payments: true,
      delivery: true,
      paymentInstruction: true,
      paymentProofs: {
        select: {
          amount: true,
          id: true,
          reference: true,
          status: true,
          submittedAt: true,
        },
        orderBy: { submittedAt: "desc" as const },
      },
    },
  },
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

  async createShareLink(auth: OwnerAuthContext, id: string) {
    const receipt = await this.assertOwned(auth.businessId, id);
    const generated = createOpaqueToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.receiptShareToken.create({
        data: {
          receiptId: receipt.id,
          tokenHash: generated.tokenHash,
        },
      });
      await tx.receipt.update({
        where: { id: receipt.id },
        data: {
          status: receipt.status === "CREATED" ? "SENT" : undefined,
          sentAt: receipt.sentAt ?? new Date(),
        },
      });
      if (!receipt.sentAt) {
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
      }
    });
    return { token: generated.token };
  }

  async getPublic(token: string) {
    const receipt = await this.findPublicReceipt(token);
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
    const receipt = await this.findPublicReceipt(token);
    if (!receipt || receipt.status === "VOID") {
      throw new NotFoundException("Receipt not found");
    }
    return receipt;
  }

  private async findPublicReceipt(token: string) {
    const tokenHash = hashToken(token);
    const receipt = await this.prisma.receipt.findUnique({
      where: { tokenHash },
      include: receiptInclude,
    });
    if (receipt) return receipt;
    const shared = await this.prisma.receiptShareToken.findUnique({
      where: { tokenHash },
      include: {
        receipt: { include: receiptInclude },
      },
    });
    if (!shared || shared.revokedAt) return null;
    return shared.receipt;
  }
}

function sanitizePublicReceipt(receipt: Awaited<ReturnType<ReceiptsService["get"]>>) {
  return {
    acknowledgedAt: receipt.acknowledgedAt,
    receiptCode: receipt.receiptCode,
    business: {
      name: receipt.business.name,
      slug: receipt.business.slug,
      logoAsset: receipt.business.logoAsset
        ? { secureUrl: receipt.business.logoAsset.secureUrl }
        : null,
      preferences: receipt.business.preferences
        ? { theme: receipt.business.preferences.theme }
        : null,
    },
    customer: {
      name: receipt.customer.name,
    },
    sale: {
      amountPaid: receipt.sale.amountPaid,
      channel: receipt.sale.channel,
      currency: receipt.sale.currency,
      deliveryFee: receipt.sale.deliveryFee,
      protectedPayment: false,
      subtotal: receipt.sale.subtotal,
      total: receipt.sale.total,
      items: receipt.sale.items.map((item) => ({
        id: item.id,
        imageUrl: item.imageUrl,
        name: item.name,
        quantity: item.quantity,
        total: item.total,
        unitPrice: item.unitPrice,
      })),
      payments: receipt.sale.payments.map((payment) => ({
        amount: payment.amount,
        createdAt: payment.createdAt,
        id: payment.id,
        note: payment.note,
        reference: payment.reference,
      })),
      paymentInstruction: receipt.sale.paymentInstruction
        ? {
            accountName: receipt.sale.paymentInstruction.accountName,
            accountNumber: receipt.sale.paymentInstruction.accountNumber,
            bankName: receipt.sale.paymentInstruction.bankName,
            instructions: receipt.sale.paymentInstruction.instructions,
            method: receipt.sale.paymentInstruction.method,
          }
        : null,
      paymentProofs: receipt.sale.paymentProofs.map((proof) => ({
        amount: proof.amount,
        id: proof.id,
        reference: proof.reference,
        status: proof.status,
        submittedAt: proof.submittedAt,
      })),
      delivery: receipt.sale.delivery
        ? {
            address: receipt.sale.delivery.address,
            status: receipt.sale.delivery.status,
            trackingUrl: receipt.sale.delivery.trackingUrl,
          }
        : null,
    },
  };
}
