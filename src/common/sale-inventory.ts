import { BadRequestException } from "@nestjs/common";
import type { Prisma, SaleItemInventorySource } from "../generated/prisma/client";

export type InventoryClaim = {
  label: string;
  productId: string;
  quantity: number;
  source: SaleItemInventorySource;
  variantId?: string;
};

export async function consumeSaleInventory(
  tx: Prisma.TransactionClient,
  claims: InventoryClaim[],
) {
  for (const claim of groupedClaims(claims)) {
    const updated = claim.source === "VARIANT"
      ? await tx.productVariant.updateMany({
          where: {
            active: true,
            id: claim.variantId,
            productId: claim.productId,
            stockCount: { gte: claim.quantity },
          },
          data: { stockCount: { decrement: claim.quantity } },
        })
      : await tx.product.updateMany({
          where: {
            id: claim.productId,
            stockCount: { gte: claim.quantity },
          },
          data: { stockCount: { decrement: claim.quantity } },
        });
    if (updated.count !== 1) {
      throw new BadRequestException(
        `${claim.label} no longer has enough stock for this order`,
      );
    }
  }
}

export async function cancelSaleAndRestoreInventory(
  tx: Prisma.TransactionClient,
  saleId: string,
) {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      items: {
        select: {
          inventorySource: true,
          name: true,
          productId: true,
          quantity: true,
          variantId: true,
          variantName: true,
        },
      },
    },
  });
  if (!sale) return false;

  const marked = await tx.sale.updateMany({
    where: { id: saleId, inventoryRestoredAt: null },
    data: { inventoryRestoredAt: new Date(), status: "CANCELED" },
  });
  if (marked.count !== 1) {
    await tx.sale.updateMany({
      where: { id: saleId, status: { not: "CANCELED" } },
      data: { status: "CANCELED" },
    });
    return false;
  }

  const claims = sale.items.flatMap((item): InventoryClaim[] => {
    if (!item.productId || !item.inventorySource) return [];
    return [{
      label: item.variantName ? `${item.name} (${item.variantName})` : item.name,
      productId: item.productId,
      quantity: item.quantity,
      source: item.inventorySource,
      variantId: item.variantId ?? undefined,
    }];
  });
  for (const claim of groupedClaims(claims)) {
    if (claim.source === "VARIANT" && claim.variantId) {
      await tx.productVariant.updateMany({
        where: { id: claim.variantId, productId: claim.productId },
        data: { stockCount: { increment: claim.quantity } },
      });
    } else if (claim.source === "PRODUCT") {
      await tx.product.updateMany({
        where: { id: claim.productId },
        data: { stockCount: { increment: claim.quantity } },
      });
    }
  }
  return true;
}

function groupedClaims(claims: InventoryClaim[]) {
  const grouped = new Map<string, InventoryClaim>();
  for (const claim of claims) {
    const key = `${claim.source}:${claim.productId}:${claim.variantId ?? ""}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity += claim.quantity;
    else grouped.set(key, { ...claim });
  }
  return [...grouped.values()];
}
