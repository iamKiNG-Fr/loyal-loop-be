import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import { CartsService } from "./carts.service";

const auth = { customerAccountId: "account-1", sessionId: "session-1" };

describe("CartsService", () => {
  it("requires a variant when a product has multiple active choices", async () => {
    const prisma = basePrisma();
    prisma.product.findFirst.mockResolvedValue({
      businessId: "business-1", id: "product-1", price: "1000", stockCount: 10,
      variants: [{ id: "v1" }, { id: "v2" }],
    });
    const service = new CartsService(prisma as unknown as PrismaService, promotions() as never);
    await expect(service.addAccountItem(auth, { productId: "product-1", quantity: 1 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an increment that exceeds current variant stock", async () => {
    const prisma = basePrisma();
    prisma.product.findFirst.mockResolvedValue({
      businessId: "business-1", id: "product-1", price: "1000", stockCount: null,
      variants: [{ id: "v1", priceOverride: null, stockCount: 2 }],
    });
    prisma.customerCartItem.findUnique.mockResolvedValue({ quantity: 2 });
    const service = new CartsService(prisma as unknown as PrismaService, promotions() as never);
    await expect(service.addAccountItem(auth, { productId: "product-1", quantity: 1, variantId: "v1" }))
      .rejects.toThrow("Requested quantity is not in stock");
  });

  it("replays a successful per-shop submission even after that group left the cart", async () => {
    const prisma = basePrisma();
    const cart = { groups: [], id: "cart-1", items: [], status: "ACTIVE", updatedAt: new Date() };
    prisma.customerCart.findUniqueOrThrow.mockResolvedValue(cart);
    prisma.orderRequest.findFirst.mockResolvedValue({ id: "request-1", items: [] });
    const service = new CartsService(prisma as unknown as PrismaService, promotions() as never);
    const result = await service.submit(auth, {
      businessIds: ["business-1"], confirmedChanges: true, idempotencyKey: "stable-request-key",
    });
    expect(result.results).toEqual([
      expect.objectContaining({ businessId: "business-1", ok: true, replayed: true }),
    ]);
  });
});

function basePrisma() {
  return {
    customerAccount: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: "account-1", phone: "+2348012345678" }) },
    customerCart: {
      findUniqueOrThrow: vi.fn(),
      upsert: vi.fn().mockResolvedValue({ id: "cart-1" }),
    },
    customerCartItem: { findUnique: vi.fn(), upsert: vi.fn() },
    customerCartGroup: { upsert: vi.fn() },
    orderRequest: { findFirst: vi.fn() },
    product: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  } as Record<string, any>;
}

function promotions() {
  return { quote: vi.fn(), reserve: vi.fn() };
}
