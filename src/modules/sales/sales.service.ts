import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { paginated } from "../../common/api-response";
import {
  createOpaqueToken,
  createReference,
} from "../../common/crypto.util";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma } from "../../generated/prisma/client";
import { ActivityService } from "../activity/activity.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateSaleDto,
  RecordPaymentDto,
  SaleListDto,
} from "./dto/sale.dto";

const saleInclude = {
  customer: true,
  items: true,
  payments: { orderBy: { createdAt: "asc" as const } },
  receipt: true,
  delivery: { include: { events: { orderBy: { createdAt: "asc" as const } } } },
};

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async list(auth: OwnerAuthContext, query: SaleListDto) {
    const where: Prisma.SaleWhereInput = {
      businessId: auth.businessId,
      customerId: query.customerId,
      paymentStatus: query.paymentStatus,
      channel: query.channel,
      soldAt:
        query.dateFrom || query.dateTo
          ? {
              gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
              lte: query.dateTo ? new Date(query.dateTo) : undefined,
            }
          : undefined,
      ...(query.query
        ? {
            OR: [
              {
                referenceCode: {
                  contains: query.query,
                  mode: "insensitive" as const,
                },
              },
              {
                customer: {
                  name: {
                    contains: query.query,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                items: {
                  some: {
                    name: {
                      contains: query.query,
                      mode: "insensitive" as const,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.sale.findMany({
        where,
        include: saleInclude,
        orderBy: { soldAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.sale.count({ where }),
    ]);
    return paginated(items, total, query.page, query.pageSize);
  }

  get(auth: OwnerAuthContext, id: string) {
    return this.prisma.sale.findFirstOrThrow({
      where: {
        businessId: auth.businessId,
        OR: [{ id }, { referenceCode: id }],
      },
      include: saleInclude,
    });
  }

  async create(
    auth: OwnerAuthContext,
    dto: CreateSaleDto,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      const existing = await this.prisma.sale.findFirst({
        where: { businessId: auth.businessId, idempotencyKey },
        include: saleInclude,
      });
      if (existing) return { sale: existing };
    }
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, businessId: auth.businessId },
    });
    if (!customer) throw new NotFoundException("Customer not found");

    const productIds = dto.items
      .map((item) => item.productId)
      .filter((id): id is string => Boolean(id));
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, businessId: auth.businessId },
      include: {
        images: {
          where: { isPrimary: true },
          include: { asset: true },
          take: 1,
        },
      },
    });
    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException("One or more products are invalid");
    }
    if (dto.sourceRequestId) {
      const request = await this.prisma.orderRequest.findFirst({
        where: {
          id: dto.sourceRequestId,
          businessId: auth.businessId,
          status: { notIn: ["CONVERTED", "CANCELED"] },
        },
      });
      if (!request) throw new BadRequestException("Order request cannot be converted");
    }

    const lines = dto.items.map((item) => {
      const product = item.productId
        ? products.find((entry) => entry.id === item.productId)
        : undefined;
      const unitPrice = new Prisma.Decimal(item.unitPrice);
      const adjusted = product ? !unitPrice.equals(product.price) : false;
      if (adjusted && !item.priceAdjustmentReason?.trim()) {
        throw new BadRequestException(
          `A price adjustment reason is required for ${product!.name}`,
        );
      }
      return {
        productId: product?.id,
        name: product?.name ?? (item.name.trim() || "Item"),
        imageUrl: item.imageUrl ?? product?.images[0]?.asset.secureUrl,
        quantity: item.quantity,
        catalogUnitPrice: product?.price,
        unitPrice,
        priceAdjustmentReason: adjusted
          ? item.priceAdjustmentReason!.trim()
          : undefined,
        total: unitPrice.mul(item.quantity),
      };
    });
    const subtotal = lines.reduce(
      (sum, item) => sum.add(item.total),
      new Prisma.Decimal(0),
    );
    const discount = new Prisma.Decimal(dto.discount ?? 0);
    const deliveryFee = new Prisma.Decimal(dto.deliveryFee ?? 0);
    const total = subtotal.sub(discount).add(deliveryFee);
    if (total.isNegative()) throw new BadRequestException("Discount exceeds subtotal");
    const amountPaid = new Prisma.Decimal(dto.amountPaid ?? 0);
    if (amountPaid.greaterThan(total)) {
      throw new BadRequestException("Amount paid exceeds sale total");
    }
    const paymentStatus = statusFromAmounts(amountPaid, total);
    const receiptToken = createOpaqueToken();
    const deliveryToken = createOpaqueToken();
    const referenceCode = createReference("LL");
    const receiptCode = createReference("RCP");
    const fulfillment = dto.fulfillment ?? "NOT_REQUIRED";

    let sale;
    try {
      sale = await this.prisma.$transaction(async (tx) => {
      const preferences = await tx.businessPreferences.findUnique({
        where: { businessId: auth.businessId },
      });
      const created = await tx.sale.create({
        data: {
          businessId: auth.businessId,
          customerId: customer.id,
          sourceRequestId: dto.sourceRequestId,
          idempotencyKey,
          referenceCode,
          paymentStatus,
          channel: dto.channel ?? "OTHER",
          fulfillment,
          currency: preferences?.currency ?? "NGN",
          subtotal,
          discount,
          deliveryFee,
          total,
          amountPaid,
          notes: dto.notes?.trim(),
          items: { create: lines },
        },
      });
      if (amountPaid.greaterThan(0)) {
        await tx.paymentEntry.create({
          data: {
            saleId: created.id,
            recordedById: auth.userId,
            type: "PAYMENT",
            amount: amountPaid,
            note: "Opening payment",
          },
        });
      }
      const receipt = await tx.receipt.create({
        data: {
          businessId: auth.businessId,
          customerId: customer.id,
          saleId: created.id,
          tokenHash: receiptToken.tokenHash,
          receiptCode,
          note: dto.receiptNote?.trim(),
          footer: preferences?.receiptFooter,
        },
      });
      let delivery:
        | { id: string; status: string }
        | undefined;
      if (fulfillment !== "NOT_REQUIRED") {
        delivery = await tx.delivery.create({
          data: {
            businessId: auth.businessId,
            customerId: customer.id,
            saleId: created.id,
            tokenHash: deliveryToken.tokenHash,
            status: fulfillment === "PICKUP" ? "READY_FOR_PICKUP" : "PREPARING",
            address: dto.deliveryAddress?.trim(),
            googlePlaceId: dto.deliveryPlaceId?.trim(),
            latitude: dto.deliveryLatitude,
            longitude: dto.deliveryLongitude,
            events: {
              create: {
                actorId: auth.userId,
                status: fulfillment === "PICKUP" ? "READY_FOR_PICKUP" : "PREPARING",
                note: "Fulfilment created with sale",
              },
            },
          },
        });
      }
      await tx.customer.update({
        where: { id: customer.id },
        data: { lastPurchasedAt: new Date() },
      });
      if (dto.sourceRequestId) {
        await tx.orderRequest.update({
          where: { id: dto.sourceRequestId },
          data: { status: "CONVERTED", customerId: customer.id },
        });
      }
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId: customer.id,
          saleId: created.id,
          type: "SALE_LOGGED",
          title: `Logged sale ${referenceCode}`,
        },
        tx,
      );
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId: customer.id,
          saleId: created.id,
          receiptId: receipt.id,
          type: "RECEIPT_CREATED",
          title: `Created receipt ${receiptCode}`,
          awardTrust: false,
        },
        tx,
      );
      return tx.sale.findUniqueOrThrow({
        where: { id: created.id },
        include: saleInclude,
      });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        (idempotencyKey || dto.sourceRequestId)
      ) {
        const existing = await this.prisma.sale.findFirst({
          where: {
            businessId: auth.businessId,
            OR: [
              ...(idempotencyKey ? [{ idempotencyKey }] : []),
              ...(dto.sourceRequestId
                ? [{ sourceRequestId: dto.sourceRequestId }]
                : []),
            ],
          },
          include: saleInclude,
        });
        if (existing) return { sale: existing };
      }
      throw error;
    }
    return {
      sale,
      receiptToken: receiptToken.token,
      ...(fulfillment !== "NOT_REQUIRED"
        ? { deliveryToken: deliveryToken.token }
        : {}),
    };
  }

  async recordPayment(
    auth: OwnerAuthContext,
    saleId: string,
    dto: RecordPaymentDto,
  ) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, businessId: auth.businessId },
    });
    if (!sale) throw new NotFoundException("Sale not found");
    const amount = new Prisma.Decimal(dto.amount);
    const nextPaid =
      dto.type === "REFUND"
        ? sale.amountPaid.sub(amount)
        : sale.amountPaid.add(amount);
    if (nextPaid.isNegative() || nextPaid.greaterThan(sale.total)) {
      throw new BadRequestException("Payment would produce an invalid balance");
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.paymentEntry.create({
        data: {
          saleId,
          recordedById: auth.userId,
          type: dto.type,
          amount,
          note: dto.note?.trim(),
          reference: dto.reference?.trim(),
        },
      });
      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          amountPaid: nextPaid,
          paymentStatus: statusFromAmounts(nextPaid, sale.total),
        },
        include: saleInclude,
      });
      await this.activity.record(
        {
          businessId: auth.businessId,
          actorId: auth.userId,
          customerId: sale.customerId,
          saleId,
          type: "PAYMENT_UPDATED",
          title: `Payment updated for ${sale.referenceCode}`,
          awardTrust: false,
        },
        tx,
      );
      return updated;
    });
  }
}

export function statusFromAmounts(
  amountPaid: Prisma.Decimal,
  total: Prisma.Decimal,
) {
  if (amountPaid.equals(0)) return "UNPAID" as const;
  if (amountPaid.greaterThanOrEqualTo(total)) return "PAID" as const;
  return "PARTIAL" as const;
}
