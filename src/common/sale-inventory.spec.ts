import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  cancelSaleAndRestoreInventory,
  consumeSaleInventory,
} from "./sale-inventory";

describe("sale inventory", () => {
  it("atomically consumes grouped variant quantities", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      product: { updateMany: vi.fn() },
      productVariant: { updateMany },
    };

    await consumeSaleInventory(tx as never, [
      { label: "Tee (Large)", productId: "product-1", quantity: 1, source: "VARIANT", variantId: "variant-1" },
      { label: "Tee (Large)", productId: "product-1", quantity: 2, source: "VARIANT", variantId: "variant-1" },
    ]);

    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        active: true,
        id: "variant-1",
        productId: "product-1",
        stockCount: { gte: 3 },
      },
      data: { stockCount: { decrement: 3 } },
    });
  });

  it("rejects a sale when the conditional stock update loses a race", async () => {
    const tx = {
      product: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      productVariant: { updateMany: vi.fn() },
    };

    await expect(consumeSaleInventory(tx as never, [
      { label: "Candle", productId: "product-1", quantity: 2, source: "PRODUCT" },
    ])).rejects.toBeInstanceOf(BadRequestException);
  });

  it("restores consumed stock once when a sale is canceled", async () => {
    const variantUpdate = vi.fn().mockResolvedValue({ count: 1 });
    const saleUpdate = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });
    const tx = {
      product: { updateMany: vi.fn() },
      productVariant: { updateMany: variantUpdate },
      sale: {
        findUnique: vi.fn().mockResolvedValue({
          id: "sale-1",
          items: [{
            inventorySource: "VARIANT",
            name: "Tee",
            productId: "product-1",
            quantity: 2,
            variantId: "variant-1",
            variantName: "Large",
          }],
        }),
        updateMany: saleUpdate,
      },
    };

    await expect(cancelSaleAndRestoreInventory(tx as never, "sale-1")).resolves.toBe(true);
    await expect(cancelSaleAndRestoreInventory(tx as never, "sale-1")).resolves.toBe(false);
    expect(variantUpdate).toHaveBeenCalledOnce();
    expect(variantUpdate).toHaveBeenCalledWith({
      where: { id: "variant-1", productId: "product-1" },
      data: { stockCount: { increment: 2 } },
    });
  });
});
