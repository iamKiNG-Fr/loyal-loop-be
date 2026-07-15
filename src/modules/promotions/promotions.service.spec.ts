import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../generated/prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import { PromotionsService } from "./promotions.service";

describe("PromotionsService", () => {
  it("calculates an eligible percentage offer while retaining the original price", async () => {
    const prisma = basePrisma();
    prisma.product.findFirst.mockResolvedValue({
      businessId: "business-1",
      id: "product-1",
      price: new Prisma.Decimal(10000),
      promotions: [{ id: "promo-1", name: "Launch offer", type: "PERCENTAGE", percentage: 20, promotionalPrice: null, startsAt: null, endsAt: null, claimLimit: 10, perCustomerLimit: 2, variantId: null }],
      variants: [],
    });
    prisma.promotionReservation.aggregate.mockResolvedValue({ _sum: { quantity: 0 } });
    const quote = await new PromotionsService(prisma as unknown as PrismaService).quote(prisma as never, {
      businessId: "business-1", customerKey: "account:1", productId: "product-1", quantity: 1,
    });
    expect(quote.originalUnitPrice.toString()).toBe("10000");
    expect(quote.unitPrice.toString()).toBe("8000");
    expect(quote.promotionId).toBe("promo-1");
  });

  it("falls back to the current price when a customer claim cap is exhausted", async () => {
    const prisma = basePrisma();
    prisma.product.findFirst.mockResolvedValue({
      businessId: "business-1", id: "product-1", price: new Prisma.Decimal(10000), variants: [],
      promotions: [{ id: "promo-1", name: "One each", type: "PERCENTAGE", percentage: 10, promotionalPrice: null, startsAt: null, endsAt: null, claimLimit: null, perCustomerLimit: 1, variantId: null }],
    });
    prisma.promotionReservation.aggregate
      .mockResolvedValueOnce({ _sum: { quantity: 1 } })
      .mockResolvedValueOnce({ _sum: { quantity: 1 } });
    const quote = await new PromotionsService(prisma as unknown as PrismaService).quote(prisma as never, {
      businessId: "business-1", customerKey: "account:1", productId: "product-1", quantity: 1,
    });
    expect(quote.promotionId).toBeUndefined();
    expect(quote.unitPrice.toString()).toBe("10000");
  });

  it("rejects a fixed promotional price that is not actually lower", async () => {
    const prisma = basePrisma();
    prisma.product.findFirst.mockResolvedValue({ id: "product-1", price: new Prisma.Decimal(10000), variants: [] });
    const service = new PromotionsService(prisma as unknown as PrismaService);
    await expect(service.create({ businessId: "business-1" } as never, {
      name: "Not a discount", productId: "product-1", promotionalPrice: "10000", type: "FIXED_PRICE",
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});

function basePrisma() {
  return {
    product: { findFirst: vi.fn() },
    productPromotion: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    promotionReservation: { aggregate: vi.fn(), create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  } as Record<string, any>;
}
