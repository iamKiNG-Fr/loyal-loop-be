import { BadRequestException } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";

export type RentalUnit = "HOUR" | "DAY";
export type RentalTerms = {
  startAt: string; endAt: string; unit: RentalUnit; rate: string; units: number;
  unitPrice: string; policy: string; lateUnit: RentalUnit; lateRate: string;
};
export type RentalPolicy = { rentalPolicy?: string | null; rentalLateUnit?: string | null; rentalLateRate?: Prisma.Decimal | string | null };

export function rentalUnit(attributes: unknown): RentalUnit | null {
  const unit = attributes && typeof attributes === "object" && !Array.isArray(attributes)
    ? (attributes as Record<string, unknown>).rentalUnit : null;
  return unit === "HOUR" || unit === "DAY" ? unit : null;
}

export function rentalPeriod(start: string | Date | null | undefined, end: string | Date | null | undefined) {
  if ([start, end].some(value => typeof value === "string" && !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))) throw new BadRequestException("Rental times must include a time zone");
  const startAt = new Date(start ?? ""), endAt = new Date(end ?? "");
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
    throw new BadRequestException("Choose a rental start and a later return date and time");
  }
  if (endAt.getTime() - startAt.getTime() > 366 * 86_400_000) throw new BadRequestException("A rental can last up to one year");
  return { startAt, endAt };
}

export function quoteRental(unit: RentalUnit, rate: Prisma.Decimal | string, start: string | Date | null | undefined, end: string | Date | null | undefined, preferences: RentalPolicy = {}): RentalTerms {
  const period = rentalPeriod(start, end);
  const units = Math.ceil((period.endAt.getTime() - period.startAt.getTime()) / (unit === "HOUR" ? 3_600_000 : 86_400_000));
  const amount = new Prisma.Decimal(rate);
  const unitPrice = amount.mul(units);
  if (amount.isNegative() || unitPrice.greaterThan("9999999999.99")) throw new BadRequestException("Rental total is outside the supported range");
  return {
    startAt: period.startAt.toISOString(), endAt: period.endAt.toISOString(), unit, rate: amount.toFixed(2), units, unitPrice: unitPrice.toFixed(2),
    policy: preferences.rentalPolicy?.trim() || "Return all items by the agreed date and time. Contact the shop to arrange your return.",
    lateUnit: preferences.rentalLateUnit === "HOUR" ? "HOUR" : "DAY",
    lateRate: new Prisma.Decimal(preferences.rentalLateRate ?? 0).toFixed(2),
  };
}

export function readRentalTerms(value: unknown): RentalTerms | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const terms = value as RentalTerms;
  if ((terms.unit !== "HOUR" && terms.unit !== "DAY") || typeof terms.startAt !== "string" || typeof terms.endAt !== "string" || typeof terms.rate !== "string") return null;
  return terms;
}

export function rentalLateFee(terms: RentalTerms, quantity: number, returnedAt: Date) {
  const lateMs = Math.max(0, returnedAt.getTime() - new Date(terms.endAt).getTime());
  const units = Math.ceil(lateMs / (terms.lateUnit === "HOUR" ? 3_600_000 : 86_400_000));
  const amount = new Prisma.Decimal(terms.lateRate).mul(units).mul(quantity);
  return { units, amount };
}

type Reservation = { rentalStartAt: Date | null; rentalEndAt: Date | null; rentalDispatchedAt?: Date | null; rentalReceivedAt?: Date | null; rentalReturnedAt?: Date | null; quantity: number };

// Endpoints are exclusive: an item due at noon can be booked again from noon.
// An overdue item already handed over stays unavailable until its return is recorded.
export function remainingRentalCapacity(capacity: number, startAt: Date, endAt: Date, reservations: Reservation[], now = new Date()) {
  const events: Array<[number, number]> = [];
  for (const booking of reservations) {
    if (!booking.rentalStartAt || !booking.rentalEndAt || booking.rentalReturnedAt) continue;
    const end = (booking.rentalReceivedAt || booking.rentalDispatchedAt) && booking.rentalEndAt < now ? Infinity : booking.rentalEndAt.getTime();
    const start = Math.max(startAt.getTime(), booking.rentalStartAt.getTime());
    const finish = Math.min(endAt.getTime(), end);
    if (start < finish) events.push([start, booking.quantity], [finish, -booking.quantity]);
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let used = 0, peak = 0;
  for (const [, change] of events) { used += change; peak = Math.max(used, peak); }
  return Math.max(0, capacity - peak);
}

export async function rentalAvailability(db: Pick<Prisma.TransactionClient, "saleItem">, productId: string, capacity: number, startAt: Date, endAt: Date, now = new Date(), pending: Reservation[] = []) {
  const reservations = await db.saleItem.findMany({
    where: { productId, rentalStartAt: { lt: endAt }, rentalReturnedAt: null,
      AND: [
        { OR: [{ sale: { status: { not: "CANCELED" } } }, { rentalReceivedAt: { not: null } }, { rentalDispatchedAt: { not: null } }] },
        { OR: [{ rentalEndAt: { gt: startAt } }, { OR: [{ rentalReceivedAt: { not: null } }, { rentalDispatchedAt: { not: null } }], rentalEndAt: { lt: now } }] },
      ] },
    select: { rentalStartAt: true, rentalEndAt: true, rentalDispatchedAt: true, rentalReceivedAt: true, rentalReturnedAt: true, quantity: true },
  });
  return remainingRentalCapacity(capacity, startAt, endAt, [...reservations, ...pending], now);
}

export async function reserveRentalCapacity(tx: Prisma.TransactionClient, lines: Array<{ productId?: string; quantity: number; rental?: RentalTerms }>, verifyCurrentRate = false) {
  const rentals = lines.filter(line => line.productId && line.rental);
  for (const productId of [...new Set(rentals.map(line => line.productId!))].sort()) {
    // Serialize bookings and capacity edits on the same product in the caller's transaction.
    const product = await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
    if (!rentalUnit(product.attributes) || product.stockCount == null || product.status !== "ACTIVE") throw new BadRequestException("This rental is no longer available");
    const pending: Reservation[] = [];
    for (const line of rentals.filter(item => item.productId === productId)) {
      if (verifyCurrentRate && (rentalUnit(product.attributes) !== line.rental!.unit || !product.price.equals(line.rental!.rate))) throw new BadRequestException("The rental rate changed. Refresh the listing and review the total");
      const { startAt, endAt } = rentalPeriod(line.rental!.startAt, line.rental!.endAt);
      if (startAt < new Date()) throw new BadRequestException("The rental start time has passed. Ask the customer to choose new dates");
      const available = await rentalAvailability(tx, productId, product.stockCount, startAt, endAt, new Date(), pending);
      if (available < line.quantity) throw new BadRequestException(`${product.name} does not have enough items available for these dates`);
      pending.push({ rentalStartAt: startAt, rentalEndAt: endAt, quantity: line.quantity });
    }
  }
}
