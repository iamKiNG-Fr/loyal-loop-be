import { rentalUnit } from "./rental";
import { BadRequestException } from "@nestjs/common";

export function isMadeToOrder(attributes: unknown): boolean {
  return Boolean(attributes && typeof attributes === "object" && !Array.isArray(attributes) && (attributes as Record<string, unknown>).madeToOrder === true);
}

export function productSupply(dto: { rentalUnit?: "HOUR" | "DAY" | "NONE"; madeToOrder?: boolean; stockCount?: number; attributes?: Record<string, string | number | boolean> }, existing?: { attributes: unknown; stockCount?: number | null }) {
  const unit = dto.rentalUnit === "NONE" ? null : dto.rentalUnit ?? rentalUnit(existing?.attributes);
  if (unit && dto.madeToOrder) throw new BadRequestException("Choose rental or made to order for this listing");
  const madeToOrder = unit ? false : dto.madeToOrder ?? isMadeToOrder(existing?.attributes);
  if (unit && (dto.stockCount ?? existing?.stockCount ?? 0) < 1) throw new BadRequestException("Enter at least one item in your rental inventory");
  if (!madeToOrder && isMadeToOrder(existing?.attributes) && dto.stockCount == null) {
    throw new BadRequestException("Enter available stock when switching from made to order");
  }
  const previous = existing?.attributes && typeof existing.attributes === "object" && !Array.isArray(existing.attributes) ? existing.attributes : {};
  return {
    rentalUnit: unit,
    madeToOrder,
    attributes: { ...previous, ...dto.attributes, madeToOrder, rentalUnit: unit ?? "NONE" },
    stockCount: madeToOrder ? null : dto.stockCount,
  };
}
