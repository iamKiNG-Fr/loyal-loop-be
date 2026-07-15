import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { OwnerAuthContext } from "../../common/request-context";
import { Prisma, type PromotionStatus } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePromotionDto, UpdatePromotionDto } from "./dto/promotion.dto";

type PromotionDb = PrismaService | Prisma.TransactionClient;

export type PromotionQuote = {
  originalUnitPrice: Prisma.Decimal;
  promotionId?: string;
  promotionSnapshot?: Prisma.InputJsonValue;
  unitPrice: Prisma.Decimal;
};

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(auth: OwnerAuthContext, productId?: string) {
    return this.prisma.productPromotion.findMany({
      where: { businessId: auth.businessId, productId },
      include: { product: { select: { id: true, name: true, price: true } }, variant: true, _count: { select: { reservations: true } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    });
  }

  async create(auth: OwnerAuthContext, dto: CreatePromotionDto) {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, businessId: auth.businessId },
      include: { variants: true },
    });
    if (!product) throw new NotFoundException("Product not found");
    const variant = dto.variantId ? product.variants.find((item) => item.id === dto.variantId) : undefined;
    if (dto.variantId && !variant) throw new BadRequestException("That variant does not belong to this product");
    const basePrice = variant?.priceOverride ?? product.price;
    this.validateOffer(dto.type, dto.percentage, dto.promotionalPrice, basePrice);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (startsAt && endsAt && startsAt >= endsAt) throw new BadRequestException("End time must be after the start time");
    const overlapping = await this.prisma.productPromotion.count({
      where: {
        businessId: auth.businessId,
        productId: product.id,
        variantId: dto.variantId ?? null,
        status: "ACTIVE",
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gt: startsAt ?? new Date() } }] },
          { OR: [{ startsAt: null }, ...(endsAt ? [{ startsAt: { lt: endsAt } }] : [])] },
        ],
      },
    });
    if (overlapping) throw new BadRequestException("Pause the existing offer for this product before starting another one");
    return this.prisma.productPromotion.create({
      data: {
        businessId: auth.businessId,
        productId: product.id,
        variantId: variant?.id,
        name: dto.name.trim(),
        type: dto.type,
        percentage: dto.type === "PERCENTAGE" ? dto.percentage : null,
        promotionalPrice: dto.type === "FIXED_PRICE" ? dto.promotionalPrice : null,
        startsAt,
        endsAt,
        claimLimit: dto.claimLimit,
        perCustomerLimit: dto.perCustomerLimit ?? 1,
      },
      include: { product: { select: { id: true, name: true, price: true } }, variant: true },
    });
  }

  async update(auth: OwnerAuthContext, id: string, dto: UpdatePromotionDto) {
    const current = await this.prisma.productPromotion.findFirst({ where: { id, businessId: auth.businessId } });
    if (!current) throw new NotFoundException("Promotion not found");
    const startsAt = dto.startsAt === undefined ? current.startsAt : new Date(dto.startsAt);
    const endsAt = dto.endsAt === undefined ? current.endsAt : new Date(dto.endsAt);
    if (startsAt && endsAt && startsAt >= endsAt) throw new BadRequestException("End time must be after the start time");
    return this.prisma.productPromotion.update({
      where: { id },
      data: { name: dto.name?.trim(), status: dto.status, startsAt, endsAt, claimLimit: dto.claimLimit, perCustomerLimit: dto.perCustomerLimit },
      include: { product: { select: { id: true, name: true, price: true } }, variant: true },
    });
  }

  archive(auth: OwnerAuthContext, id: string) {
    return this.update(auth, id, { status: "ARCHIVED" as PromotionStatus });
  }

  async quote(
    db: PromotionDb,
    input: { businessId: string; customerKey: string; productId: string; quantity: number; variantId?: string | null },
  ): Promise<PromotionQuote> {
    const now = new Date();
    await db.promotionReservation.updateMany({ where: { status: "RESERVED", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
    const product = await db.product.findFirst({
      where: { id: input.productId, businessId: input.businessId, status: "ACTIVE", visibility: "PUBLIC" },
      include: { variants: true, promotions: { where: { status: "ACTIVE" }, orderBy: { createdAt: "desc" } } },
    });
    if (!product) throw new BadRequestException("Product is unavailable");
    const variant = input.variantId ? product.variants.find((item) => item.id === input.variantId && item.active) : undefined;
    if (input.variantId && !variant) throw new BadRequestException("Product variant is unavailable");
    const originalUnitPrice = variant?.priceOverride ?? product.price;
    const promotion = product.promotions.find((item) =>
      (!item.variantId || item.variantId === input.variantId)
      && (!item.startsAt || item.startsAt <= now)
      && (!item.endsAt || item.endsAt > now));
    if (!promotion) return { originalUnitPrice, unitPrice: originalUnitPrice };

    const [allClaims, customerClaims] = await Promise.all([
      this.claimedQuantity(db, promotion.id, now),
      this.claimedQuantity(db, promotion.id, now, input.customerKey),
    ]);
    if ((promotion.claimLimit && allClaims + input.quantity > promotion.claimLimit)
      || customerClaims + input.quantity > promotion.perCustomerLimit) {
      return { originalUnitPrice, unitPrice: originalUnitPrice };
    }
    const unitPrice = promotion.type === "PERCENTAGE"
      ? originalUnitPrice.mul(100 - (promotion.percentage ?? 0)).div(100).toDecimalPlaces(2)
      : promotion.promotionalPrice!;
    return {
      originalUnitPrice,
      promotionId: promotion.id,
      promotionSnapshot: { endsAt: promotion.endsAt?.toISOString() ?? null, name: promotion.name, type: promotion.type, value: promotion.type === "PERCENTAGE" ? promotion.percentage : promotion.promotionalPrice?.toString() },
      unitPrice,
    };
  }

  reserve(db: PromotionDb, input: { customerAccountId?: string; customerKey: string; orderRequestId: string; quantity: number; quote: PromotionQuote }) {
    if (!input.quote.promotionId) return Promise.resolve(null);
    const minutes = 2880;
    return db.promotionReservation.create({
      data: { promotionId: input.quote.promotionId, orderRequestId: input.orderRequestId, customerAccountId: input.customerAccountId, customerKey: input.customerKey, quantity: input.quantity, expiresAt: new Date(Date.now() + minutes * 60_000) },
    });
  }

  releaseForRequest(db: PromotionDb, orderRequestId: string) {
    return db.promotionReservation.updateMany({ where: { orderRequestId, status: "RESERVED" }, data: { status: "RELEASED", releasedAt: new Date() } });
  }

  redeemForRequest(db: PromotionDb, orderRequestId: string) {
    return db.promotionReservation.updateMany({ where: { orderRequestId, status: "RESERVED", expiresAt: { gt: new Date() } }, data: { status: "REDEEMED", redeemedAt: new Date() } });
  }

  private async claimedQuantity(db: PromotionDb, promotionId: string, now: Date, customerKey?: string) {
    const total = await db.promotionReservation.aggregate({
      where: { promotionId, customerKey, OR: [{ status: "REDEEMED" }, { status: "RESERVED", expiresAt: { gt: now } }] },
      _sum: { quantity: true },
    });
    return total._sum.quantity ?? 0;
  }

  private validateOffer(type: string, percentage: number | undefined, promotionalPrice: string | undefined, basePrice: Prisma.Decimal) {
    if (type === "PERCENTAGE" && !percentage) throw new BadRequestException("Enter a percentage between 1 and 90");
    if (type === "FIXED_PRICE") {
      if (!promotionalPrice) throw new BadRequestException("Enter the promotional price");
      const value = new Prisma.Decimal(promotionalPrice);
      if (value.greaterThanOrEqualTo(basePrice)) throw new BadRequestException("Promotional price must be lower than the current price");
    }
  }
}
