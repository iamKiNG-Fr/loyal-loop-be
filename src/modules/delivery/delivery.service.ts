import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createOpaqueToken, hashToken } from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import type { DeliveryStatus } from "../../generated/prisma/client";
import { ActivityService } from "../activity/activity.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateDeliveryIssueDto,
  SubmitDeliveryFeedbackDto,
  UpdateDeliveryDto,
} from "./dto/delivery.dto";

const transitions: Record<DeliveryStatus, DeliveryStatus[]> = {
  PREPARING: ["READY_FOR_PICKUP", "IN_TRANSIT", "ISSUE", "CANCELED"],
  READY_FOR_PICKUP: ["IN_TRANSIT", "DELIVERED", "ISSUE", "CANCELED"],
  IN_TRANSIT: ["DELIVERED", "ISSUE", "CANCELED"],
  DELIVERED: ["ISSUE"],
  CONFIRMED: [],
  ISSUE: ["PREPARING", "IN_TRANSIT", "DELIVERED", "CANCELED"],
  CANCELED: [],
};

const deliveryInclude = {
  customer: true,
  sale: {
    include: {
      receipt: true,
      items: true,
      payments: true,
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
  events: { orderBy: { createdAt: "asc" as const } },
  feedback: true,
  issues: { orderBy: { openedAt: "desc" as const } },
};

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  list(auth: OwnerAuthContext) {
    return this.prisma.delivery.findMany({
      where: { businessId: auth.businessId },
      include: deliveryInclude,
      orderBy: { updatedAt: "desc" },
    });
  }

  get(auth: OwnerAuthContext, id: string) {
    return this.prisma.delivery.findFirstOrThrow({
      where: { id, businessId: auth.businessId },
      include: deliveryInclude,
    });
  }

  async createShareLink(auth: OwnerAuthContext, id: string) {
    const delivery = await this.assertOwned(auth.businessId, id);
    const generated = createOpaqueToken();
    await this.prisma.deliveryShareToken.create({
      data: {
        deliveryId: delivery.id,
        tokenHash: generated.tokenHash,
      },
    });
    return { token: generated.token };
  }

  async update(
    auth: OwnerAuthContext,
    deliveryId: string,
    dto: UpdateDeliveryDto,
  ) {
    const delivery = await this.assertOwned(auth.businessId, deliveryId);
    if (dto.status !== delivery.status && !transitions[delivery.status].includes(dto.status)) {
      throw new BadRequestException(
        `Delivery cannot move from ${delivery.status} to ${dto.status}`,
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id: deliveryId },
        data: {
          status: dto.status,
          trackingUrl: dto.trackingUrl,
          trackingCode: dto.trackingCode?.trim(),
          courier: dto.courier?.trim(),
          address: dto.address?.trim(),
          googlePlaceId: dto.googlePlaceId?.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          deliveredAt:
            dto.status === "DELIVERED" && !delivery.deliveredAt
              ? new Date()
              : undefined,
          events: {
            create: {
              actorId: auth.userId,
              status: dto.status,
              note: dto.note?.trim(),
            },
          },
        },
        include: deliveryInclude,
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId: delivery.customerId,
          saleId: delivery.saleId,
          deliveryId,
          type: "DELIVERY_STATUS_UPDATED",
          title: `Delivery moved to ${dto.status.toLowerCase().replaceAll("_", " ")}`,
          description: dto.note?.trim(),
          awardTrust: false,
        },
        tx,
      );
      return updated;
    });
  }

  async getPublic(token: string) {
    const delivery = await this.findByToken(token);
    return sanitizePublicDelivery(
      await this.prisma.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        include: {
          ...deliveryInclude,
          business: {
            include: { logoAsset: true, contacts: true, preferences: true },
          },
        },
      }),
    );
  }

  async confirm(token: string) {
    const delivery = await this.findByToken(token);
    if (delivery.status === "CONFIRMED") {
      return this.prisma.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        include: deliveryInclude,
      });
    }
    if (delivery.status !== "DELIVERED") {
      throw new BadRequestException("Delivery must be marked delivered first");
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          events: {
            create: {
              status: "CONFIRMED",
              note: "Customer confirmed delivery",
            },
          },
        },
        include: deliveryInclude,
      });
      await this.activity.record(
        {
          businessId: delivery.businessId,
          customerId: delivery.customerId,
          saleId: delivery.saleId,
          deliveryId: delivery.id,
          type: "DELIVERY_CONFIRMED",
          title: "Customer confirmed delivery",
        },
        tx,
      );
      return updated;
    });
  }

  async feedback(token: string, dto: SubmitDeliveryFeedbackDto) {
    const delivery = await this.findByToken(token);
    if (delivery.status !== "CONFIRMED") {
      throw new BadRequestException("Confirm delivery before leaving feedback");
    }
    const existing = await this.prisma.customerFeedback.findUnique({
      where: { deliveryId: delivery.id },
    });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const feedback = await tx.customerFeedback.create({
        data: {
          businessId: delivery.businessId,
          customerId: delivery.customerId,
          saleId: delivery.saleId,
          deliveryId: delivery.id,
          rating: dto.rating,
          comment: dto.comment?.trim(),
        },
      });
      await this.activity.record(
        {
          businessId: delivery.businessId,
          customerId: delivery.customerId,
          saleId: delivery.saleId,
          deliveryId: delivery.id,
          type: "FEEDBACK_SUBMITTED",
          title: "Customer feedback submitted",
          metadata: { rating: dto.rating },
        },
        tx,
      );
      return feedback;
    });
  }

  async createIssue(token: string, dto: CreateDeliveryIssueDto) {
    const delivery = await this.findByToken(token);
    return this.prisma.$transaction(async (tx) => {
      const issue = await tx.customerIssue.create({
        data: {
          businessId: delivery.businessId,
          customerId: delivery.customerId,
          saleId: delivery.saleId,
          deliveryId: delivery.id,
          description: dto.description.trim(),
        },
      });
      await this.activity.record(
        {
          businessId: delivery.businessId,
          customerId: delivery.customerId,
          saleId: delivery.saleId,
          deliveryId: delivery.id,
          type: "ISSUE_OPENED",
          title: "Customer opened a delivery issue",
          awardTrust: false,
        },
        tx,
      );
      return issue;
    });
  }

  async resolveIssue(
    auth: OwnerAuthContext,
    deliveryId: string,
    issueId: string,
  ) {
    const delivery = await this.assertOwned(auth.businessId, deliveryId);
    const issue = await this.prisma.customerIssue.findFirst({
      where: {
        id: issueId,
        deliveryId,
        businessId: auth.businessId,
        status: "OPEN",
      },
    });
    if (!issue) throw new NotFoundException("Open issue not found");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.customerIssue.update({
        where: { id: issue.id },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId: delivery.customerId,
          saleId: delivery.saleId,
          deliveryId,
          type: "ISSUE_RESOLVED",
          title: "Delivery issue resolved",
        },
        tx,
      );
      return updated;
    });
  }

  private async assertOwned(businessId: string, id: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, businessId },
    });
    if (!delivery) throw new NotFoundException("Delivery not found");
    return delivery;
  }

  private async findByToken(token: string) {
    const tokenHash = hashToken(token);
    const delivery = await this.prisma.delivery.findUnique({
      where: { tokenHash },
    });
    if (delivery) return delivery;
    const shared = await this.prisma.deliveryShareToken.findUnique({
      where: { tokenHash },
      include: { delivery: true },
    });
    if (!shared || shared.revokedAt) {
      throw new NotFoundException("Delivery not found");
    }
    return shared.delivery;
  }
}

function sanitizePublicDelivery(delivery: Record<string, unknown>) {
  const value = delivery as {
    address: string | null;
    business: {
      logoAsset: { secureUrl: string } | null;
      name: string;
    };
    confirmedAt: Date | null;
    events: Array<{
      createdAt: Date;
      id: string;
      isPublic: boolean;
      note: string | null;
      status: string;
    }>;
    feedback: Array<{ rating: number }>;
    id: string;
    sale: {
      amountPaid: unknown;
      currency: string;
      items: Array<{
        id: string;
        imageUrl: string | null;
        name: string;
        quantity: number;
        total: unknown;
      }>;
      paymentInstruction: {
        accountName: string | null;
        accountNumber: string | null;
        bankName: string | null;
        instructions: string | null;
        method: string;
      } | null;
      paymentProofs: Array<{
        amount: unknown;
        id: string;
        reference: string | null;
        status: string;
        submittedAt: Date;
      }>;
      paymentStatus: string;
      referenceCode: string;
      total: unknown;
    };
    status: string;
    trackingUrl: string | null;
  };

  return {
    address: value.address,
    business: {
      name: value.business.name,
      logoAsset: value.business.logoAsset
        ? { secureUrl: value.business.logoAsset.secureUrl }
        : null,
    },
    confirmedAt: value.confirmedAt,
    events: value.events
      .filter((event) => event.isPublic)
      .map((event) => ({
        createdAt: event.createdAt,
        id: event.id,
        note: event.note,
        status: event.status,
      })),
    feedback: value.feedback.map((entry) => ({ rating: entry.rating })),
    id: value.id,
    sale: {
      amountPaid: value.sale.amountPaid,
      currency: value.sale.currency,
      items: value.sale.items.map((item) => ({
        id: item.id,
        imageUrl: item.imageUrl,
        name: item.name,
        quantity: item.quantity,
        total: item.total,
      })),
      paymentInstruction: value.sale.paymentInstruction
        ? {
            accountName: value.sale.paymentInstruction.accountName,
            accountNumber: value.sale.paymentInstruction.accountNumber,
            bankName: value.sale.paymentInstruction.bankName,
            instructions: value.sale.paymentInstruction.instructions,
            method: value.sale.paymentInstruction.method,
          }
        : null,
      paymentProofs: value.sale.paymentProofs.map((proof) => ({
        amount: proof.amount,
        id: proof.id,
        reference: proof.reference,
        status: proof.status,
        submittedAt: proof.submittedAt,
      })),
      paymentStatus: value.sale.paymentStatus,
      referenceCode: value.sale.referenceCode,
      total: value.sale.total,
    },
    status: value.status,
    trackingUrl: value.trackingUrl,
  };
}
