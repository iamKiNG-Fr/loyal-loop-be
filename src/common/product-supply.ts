import { BadRequestException } from "@nestjs/common";

export function isMadeToOrder(attributes: unknown): boolean {
  return Boolean(attributes && typeof attributes === "object" && !Array.isArray(attributes) && (attributes as Record<string, unknown>).madeToOrder === true);
}

export function productSupply(dto: { madeToOrder?: boolean; stockCount?: number; attributes?: Record<string, string | number | boolean> }, existing?: { attributes: unknown }) {
  const madeToOrder = dto.madeToOrder ?? isMadeToOrder(existing?.attributes);
  if (!madeToOrder && isMadeToOrder(existing?.attributes) && dto.stockCount == null) {
    throw new BadRequestException("Enter available stock when switching from made to order");
  }
  const previous = existing?.attributes && typeof existing.attributes === "object" && !Array.isArray(existing.attributes) ? existing.attributes : {};
  return {
    madeToOrder,
    attributes: { ...previous, ...dto.attributes, madeToOrder },
    stockCount: madeToOrder ? null : dto.stockCount,
  };
}
