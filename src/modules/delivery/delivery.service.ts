import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createOpaqueToken, hashToken } from "../../common/crypto.util";
import { customerOrderRequestTokenWhere } from "../../common/customer-order-request-token";
import type { OwnerAuthContext } from "../../common/request-context";
import { cancelSaleAndRestoreInventory } from "../../common/sale-inventory";
import type { DeliveryStatus, MediaPurpose } from "../../generated/prisma/client";
import { ActivityService } from "../activity/activity.service";
import { MessagingService } from "../messaging/messaging.service";
import { FoundingValueFeedbackService } from "../founding-value-feedback/founding-value-feedback.service";
import { MediaService } from "../media/media.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateDeliveryIssueDto,
  ConfirmDeliveryHandoffDto,
  SubmitDeliveryFeedbackDto,
  SwitchPickupMethodDto,
  UpdateDeliveryDto,
} from "./dto/delivery.dto";

const transitions: Record<DeliveryStatus, DeliveryStatus[]> = {
  AWAITING_PAYMENT: ["CANCELED"],
  PREPARING: ["READY_FOR_PICKUP", "IN_TRANSIT", "ISSUE", "CANCELED"],
  READY_FOR_PICKUP: ["IN_TRANSIT", "DELIVERED", "ISSUE", "CANCELED"],
  IN_TRANSIT: ["DELIVERED", "ISSUE", "CANCELED"],
  DELIVERED: ["ISSUE"],
  CONFIRMED: [],
  ISSUE: ["PREPARING", "IN_TRANSIT", "DELIVERED", "CANCELED"],
  CANCELED: [],
};

const deliveryInclude = {
  handoffAsset: {
    select: {
      deliveryType: true,
      format: true,
      id: true,
      publicId: true,
      purpose: true,
      resourceType: true,
      secureUrl: true,
      status: true,
    },
  },
  pickupLocation: true,
  customer: { include: { contacts: true } },
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
          reviewNote: true,
          status: true,
          submittedAt: true,
        },
        orderBy: { submittedAt: "desc" as const },
      },
    },
  },
  events: { orderBy: { createdAt: "asc" as const } },
  feedback: true,
  issues: {
    include: { supportRequest: true },
    orderBy: { openedAt: "desc" as const },
  },
};

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
    private readonly valueFeedback: FoundingValueFeedbackService,
    private readonly media: MediaService,
  ) {}

  async list(auth: OwnerAuthContext) {
    const deliveries = await this.prisma.delivery.findMany({
      where: { businessId: auth.businessId },
      include: deliveryInclude,
      orderBy: { updatedAt: "desc" },
    });
    return deliveries.map((delivery) => this.protectDelivery(delivery));
  }

  async get(auth: OwnerAuthContext, id: string) {
    const delivery = await this.prisma.delivery.findFirstOrThrow({
      where: { id, businessId: auth.businessId },
      include: deliveryInclude,
    });
    return this.protectDelivery(delivery);
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
    if (
      delivery.status === "AWAITING_PAYMENT" &&
      dto.status !== "AWAITING_PAYMENT" &&
      dto.status !== "CANCELED"
    ) {
      throw new BadRequestException(
        "Record or verify a bank-transfer payment before starting delivery",
      );
    }
    if (dto.status !== delivery.status && !transitions[delivery.status].includes(dto.status)) {
      throw new BadRequestException(
        `Delivery cannot move from ${delivery.status} to ${dto.status}`,
      );
    }
    const courierService = updatedOptionalText(dto.courierService, delivery.courierService);
    const courierName = updatedOptionalText(dto.courierName, delivery.courierName);
    const courierPhone = updatedOptionalText(dto.courierPhone, delivery.courierPhone);
    const method = delivery.journeyMethod;
    const methodTransitions: Record<string, Partial<Record<DeliveryStatus, DeliveryStatus[]>>> = {
      SHOP_DELIVERY: {
        PREPARING: ["READY_FOR_PICKUP"],
        READY_FOR_PICKUP: ["IN_TRANSIT"],
        IN_TRANSIT: ["DELIVERED"],
      },
      CUSTOMER_PICKUP: {
        PREPARING: ["READY_FOR_PICKUP"],
        READY_FOR_PICKUP: [],
      },
      CUSTOMER_RIDER: {
        PREPARING: ["READY_FOR_PICKUP"],
        READY_FOR_PICKUP: ["IN_TRANSIT"],
        IN_TRANSIT: [],
      },
    };
    const journeyTransitions = methodTransitions[method]?.[delivery.status];
    if (
      dto.status !== delivery.status
      && journeyTransitions
      && ![...journeyTransitions, "ISSUE", "CANCELED"].includes(dto.status)
    ) {
      throw new BadRequestException(
        `This ${method.toLowerCase().replaceAll("_", " ")} journey cannot move from ${delivery.status} to ${dto.status}`,
      );
    }
    if (method === "CUSTOMER_PICKUP" && ["IN_TRANSIT", "DELIVERED"].includes(dto.status)) {
      throw new BadRequestException("Customer pickup moves from ready for pickup to code-confirmed handoff");
    }
    if (method === "CUSTOMER_RIDER" && dto.status === "DELIVERED") {
      throw new BadRequestException("A customer-rider order is confirmed by the customer after merchant handoff");
    }
    if (dto.status === "IN_TRANSIT") {
      const missing = [
        !courierService && "delivery service",
        !courierName && "rider name",
        !courierPhone && "rider phone",
      ].filter(Boolean);
      if (missing.length) {
        throw new BadRequestException(
          `Add the ${missing.join(", ")} before marking this order in transit`,
        );
      }
    }
    if (dto.handoffAssetId) {
      const asset = await this.prisma.mediaAsset.findFirst({
        where: { id: dto.handoffAssetId, businessId: auth.businessId, purpose: "DELIVERY_HANDOFF", status: "ACTIVE" },
        select: { id: true },
      });
      if (!asset) throw new BadRequestException("Handoff photo is invalid");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.status === "CANCELED") {
        const paymentState = await tx.sale.findUniqueOrThrow({
          where: { id: delivery.saleId },
          select: { amountPaid: true },
        });
        if (paymentState.amountPaid.greaterThan(0)) {
          throw new BadRequestException(
            "Record the full refund before canceling this paid order",
          );
        }
      }
      const updated = await tx.delivery.update({
        where: { id: deliveryId },
        data: {
          status: dto.status,
          trackingUrl: optionalText(dto.trackingUrl),
          trackingCode: optionalText(dto.trackingCode),
          courier: optionalText(dto.courier),
          courierService: optionalText(dto.courierService),
          courierName: optionalText(dto.courierName),
          courierPhone: optionalText(dto.courierPhone),
          handoffAssetId: dto.handoffAssetId,
          address: dto.address?.trim(),
          googlePlaceId: dto.googlePlaceId?.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          deliveredAt:
            dto.status === "DELIVERED" && !delivery.deliveredAt
              ? new Date()
              : undefined,
          handoffCodeIssuedAt:
            dto.status === "READY_FOR_PICKUP" && method !== "CUSTOMER_RIDER" && !delivery.handoffCodeIssuedAt
              ? new Date()
              : undefined,
          riderDetailsAddedAt:
            method === "CUSTOMER_RIDER" && courierName && courierPhone && !delivery.riderDetailsAddedAt
              ? new Date()
              : undefined,
          handedOffAt:
            method === "CUSTOMER_RIDER" && dto.status === "IN_TRANSIT" && !delivery.handedOffAt
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
      if (dto.status === "CANCELED") {
        await cancelSaleAndRestoreInventory(tx, delivery.saleId);
      }
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
    await this.messaging.enqueueDelivery(auth, deliveryId).catch(() => undefined);
    return this.protectDelivery(updated);
  }

  async switchPickupMethod(
    customerAccountId: string,
    token: string,
    dto: SwitchPickupMethodDto,
  ) {
    const delivery = await this.findByToken(customerAccountId, token);
    if (!["CUSTOMER_PICKUP", "CUSTOMER_RIDER"].includes(dto.method)) {
      throw new BadRequestException("Pickup can only switch between personal pickup and customer rider");
    }
    if (!["PREPARING", "READY_FOR_PICKUP"].includes(delivery.status) || delivery.handedOffAt) {
      throw new BadRequestException("Pickup method can no longer be changed after handoff");
    }
    const riderDetails = dto.method === "CUSTOMER_RIDER"
      && Boolean(dto.riderName?.trim() && dto.riderPhone?.trim());
    const updated = await this.prisma.delivery.update({
      where: { id: delivery.id },
      data: {
        journeyMethod: dto.method,
        courierService: dto.method === "CUSTOMER_RIDER" ? optionalText(dto.riderService) : null,
        courierName: dto.method === "CUSTOMER_RIDER" ? optionalText(dto.riderName) : null,
        courierPhone: dto.method === "CUSTOMER_RIDER" ? optionalText(dto.riderPhone) : null,
        trackingUrl: dto.method === "CUSTOMER_RIDER" ? optionalText(dto.trackingUrl) : null,
        riderDetailsAddedAt: riderDetails ? new Date() : null,
        handoffCodeIssuedAt: dto.method === "CUSTOMER_PICKUP" && delivery.status === "READY_FOR_PICKUP" ? new Date() : null,
        events: { create: { status: delivery.status, note: dto.method === "CUSTOMER_RIDER" ? "Customer will send a rider" : "Customer will collect personally" } },
      },
      include: deliveryInclude,
    });
    return this.protectDelivery(updated);
  }

  async confirmHandoff(auth: OwnerAuthContext, deliveryId: string, dto: ConfirmDeliveryHandoffDto) {
    const delivery = await this.assertOwned(auth.businessId, deliveryId);
    const allowed = delivery.journeyMethod === "CUSTOMER_PICKUP"
      ? delivery.status === "READY_FOR_PICKUP"
      : delivery.journeyMethod === "SHOP_DELIVERY" && delivery.status === "DELIVERED";
    if (!allowed || !delivery.handoffCodeIssuedAt) {
      throw new BadRequestException("A handoff code is not expected at this step");
    }
    if (!safeCodeEqual(this.handoffCode(delivery.id), dto.code)) {
      throw new BadRequestException("Handoff code is incorrect");
    }
    const updated = await this.completeDelivery(delivery, auth.userId, "Handoff code confirmed");
    await this.messaging.enqueueCustomerMemoryPrompt(delivery.id).catch(() => undefined);
    await this.valueFeedback.captureIfQualified(this.prisma, delivery.businessId, delivery.saleId).catch(() => undefined);
    return updated;
  }

  async getPublic(customerAccountId: string, token: string) {
    const delivery = await this.findByToken(customerAccountId, token);
    const record = await this.prisma.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        include: {
          ...deliveryInclude,
          business: {
            include: { logoAsset: true, contacts: true, preferences: true },
          },
        },
      });
    return {
      ...sanitizePublicDelivery(this.protectDelivery(record)),
      handoffCode: record.handoffCodeIssuedAt && record.journeyMethod !== "CUSTOMER_RIDER"
        ? this.handoffCode(record.id)
        : null,
    };
  }

  async confirm(customerAccountId: string, token: string) {
    const delivery = await this.findByToken(customerAccountId, token);
    if (delivery.status === "CONFIRMED") {
      const confirmed = await this.prisma.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        include: deliveryInclude,
      });
      return this.protectDelivery(confirmed);
    }
    const canConfirm = delivery.journeyMethod === "CUSTOMER_RIDER"
      ? delivery.status === "IN_TRANSIT"
      : delivery.status === "DELIVERED";
    if (!canConfirm) {
      throw new BadRequestException("The merchant must complete the handoff step first");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
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
    await this.messaging.enqueueCustomerMemoryPrompt(delivery.id).catch(() => undefined);
    await this.valueFeedback.captureIfQualified(this.prisma, delivery.businessId, delivery.saleId).catch(() => undefined);
    return this.protectDelivery(updated);
  }

  async feedback(customerAccountId: string, token: string, dto: SubmitDeliveryFeedbackDto) {
    const delivery = await this.findByToken(customerAccountId, token);
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

  async createIssue(customerAccountId: string, token: string, dto: CreateDeliveryIssueDto) {
    const delivery = await this.findByToken(customerAccountId, token);
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

  async escalateIssue(
    auth: OwnerAuthContext,
    deliveryId: string,
    issueId: string,
  ) {
    const delivery = await this.assertOwned(auth.businessId, deliveryId);
    const issue = await this.prisma.customerIssue.findFirst({
      where: { id: issueId, deliveryId, businessId: auth.businessId },
      include: { supportRequest: true },
    });
    if (!issue) throw new NotFoundException("Issue not found");
    if (issue.supportRequest) return issue.supportRequest;

    return this.prisma.supportRequest.create({
      data: {
        businessId: auth.businessId,
        customerIssueId: issue.id,
        topic: `Order issue · ${delivery.sale.referenceCode}`,
        message: issue.description,
      },
    });
  }

  private async assertOwned(businessId: string, id: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, businessId },
      include: { sale: true },
    });
    if (!delivery) throw new NotFoundException("Delivery not found");
    return delivery;
  }

  private async findByToken(customerAccountId: string, token: string) {
    const tokenHash = hashToken(token);
    const delivery = await this.prisma.delivery.findFirst({
      where: {
        tokenHash,
        OR: [
          { customer: { accountId: customerAccountId } },
          { sale: { sourceRequest: { customerAccountId } } },
        ],
      },
    });
    if (delivery) return delivery;
    const shared = await this.prisma.deliveryShareToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        delivery: {
          OR: [
            { customer: { accountId: customerAccountId } },
            { sale: { sourceRequest: { customerAccountId } } },
          ],
        },
      },
      include: { delivery: true },
    });
    if (shared) return shared.delivery;

    const convertedRequest = await this.prisma.orderRequest.findFirst({
      where: customerOrderRequestTokenWhere(customerAccountId, tokenHash),
      include: { convertedSale: { include: { delivery: true } } },
    });
    if (convertedRequest?.convertedSale?.delivery) {
      return convertedRequest.convertedSale.delivery;
    }
    throw new NotFoundException("Delivery not found");
  }

  private handoffCode(deliveryId: string) {
    const secret = this.config.get<string>("SESSION_HASH_SECRET", "");
    if (!secret) throw new BadRequestException("Handoff codes are not configured");
    const digest = createHmac("sha256", secret).update(`delivery-handoff:${deliveryId}`).digest();
    return (digest.readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
  }

  private async completeDelivery(
    delivery: { id: string; businessId: string; customerId: string; saleId: string },
    actorId: string | undefined,
    note: string,
  ) {
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.delivery.update({
        where: { id: delivery.id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
          handedOffAt: new Date(),
          events: { create: { actorId, status: "CONFIRMED", note } },
        },
        include: deliveryInclude,
      });
      await this.activity.record({
        businessId: delivery.businessId,
        actorId,
        customerId: delivery.customerId,
        saleId: delivery.saleId,
        deliveryId: delivery.id,
        type: "DELIVERY_CONFIRMED",
        title: note,
      }, tx);
      return updated;
    });
    return this.protectDelivery(updated);
  }

  private protectDelivery<T extends {
    handoffAsset: {
      deliveryType: string;
      format: string;
      publicId: string;
      purpose: MediaPurpose;
      resourceType: string;
      secureUrl: string;
      status: string;
    } | null;
  }>(delivery: T) {
    if (!("handoffAsset" in delivery)) return delivery;
    return {
      ...delivery,
      handoffAsset: delivery.handoffAsset
        ? this.media.protectAsset(delivery.handoffAsset)
        : null,
    };
  }
}

function safeCodeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual.trim());
  return left.length === right.length && timingSafeEqual(left, right);
}

function sanitizePublicDelivery(delivery: Record<string, unknown>) {
  const value = delivery as {
    address: string | null;
    business: {
      id: string;
      contacts: Array<{
        isPrimary: boolean;
        label: string | null;
        platform: string;
        value: string;
      }>;
      logoAsset: { secureUrl: string } | null;
      name: string;
    };
    confirmedAt: Date | null;
    journeyMethod: string;
    pickupLabel: string | null;
    pickupAddress: string | null;
    pickupGooglePlaceId: string | null;
    handoffAsset: { id: string; secureUrl: string } | null;
    handedOffAt: Date | null;
    riderDetailsAddedAt: Date | null;
    events: Array<{
      createdAt: Date;
      id: string;
      isPublic: boolean;
      note: string | null;
      status: string;
    }>;
    feedback: Array<{ rating: number }>;
    issues: Array<{
      description: string;
      id: string;
      openedAt: Date;
      resolvedAt: Date | null;
      status: string;
      supportRequest: {
        createdAt: Date;
        id: string;
        status: string;
      } | null;
    }>;
    id: string;
    sale: {
      amountPaid: unknown;
      currency: string;
      id: string;
      sourceRequestId: string | null;
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
        reviewNote: string | null;
        status: string;
        submittedAt: Date;
      }>;
      paymentStatus: string;
      referenceCode: string;
      total: unknown;
    };
    status: string;
    courier: string | null;
    courierName: string | null;
    courierPhone: string | null;
    courierService: string | null;
    trackingCode: string | null;
    trackingUrl: string | null;
  };

  return {
    address: value.address,
    business: {
      id: value.business.id,
      name: value.business.name,
      contacts: value.business.contacts.map((contact) => ({
        isPrimary: contact.isPrimary,
        label: contact.label,
        platform: contact.platform,
        value: contact.value,
      })),
      logoAsset: value.business.logoAsset
        ? { secureUrl: value.business.logoAsset.secureUrl }
        : null,
    },
    confirmedAt: value.confirmedAt,
    journeyMethod: value.journeyMethod,
    pickupLabel: value.pickupLabel,
    pickupAddress: value.pickupAddress,
    pickupGooglePlaceId: value.pickupGooglePlaceId,
    handedOffAt: value.handedOffAt,
    riderDetailsAddedAt: value.riderDetailsAddedAt,
    handoffAsset: value.handoffAsset,
    events: value.events
      .filter((event) => event.isPublic)
      .map((event) => ({
        createdAt: event.createdAt,
        id: event.id,
        note: event.note,
        status: event.status,
      })),
    feedback: value.feedback.map((entry) => ({ rating: entry.rating })),
    issues: value.issues.map((issue) => ({
      description: issue.description,
      id: issue.id,
      openedAt: issue.openedAt,
      resolvedAt: issue.resolvedAt,
      status: issue.status,
      supportRequest: issue.supportRequest
        ? {
            createdAt: issue.supportRequest.createdAt,
            id: issue.supportRequest.id,
            status: issue.supportRequest.status,
          }
        : null,
    })),
    id: value.id,
    sale: {
      amountPaid: value.sale.amountPaid,
      currency: value.sale.currency,
      id: value.sale.id,
      sourceRequestId: value.sale.sourceRequestId,
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
        rejectionReason: proof.status === "REJECTED" ? proof.reviewNote : null,
        status: proof.status,
        submittedAt: proof.submittedAt,
      })),
      paymentStatus: value.sale.paymentStatus,
      referenceCode: value.sale.referenceCode,
      total: value.sale.total,
    },
    status: value.status,
    courier: value.courier,
    courierName: value.courierName,
    courierPhone: value.courierPhone,
    courierService: value.courierService,
    trackingCode: value.trackingCode,
    trackingUrl: value.trackingUrl,
  };
}

function optionalText(value: string | undefined) {
  if (value === undefined) return undefined;
  return value.trim() || null;
}

function updatedOptionalText(
  next: string | undefined,
  current: string | null,
) {
  return next === undefined ? current?.trim() || null : next.trim() || null;
}
