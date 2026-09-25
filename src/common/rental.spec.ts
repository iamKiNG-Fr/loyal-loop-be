import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../generated/prisma/client";
import { productSupply } from "./product-supply";
import { quoteRental, rentalLateFee, rentalPeriod, remainingRentalCapacity, reserveRentalCapacity } from "./rental";

const at = (hour: number) => new Date(`2099-01-01T${String(hour).padStart(2, "0")}:00:00Z`);
const booking = (start: number, end: number, quantity: number) => ({ rentalStartAt: at(start), rentalEndAt: at(end), quantity });

describe("rental pricing and availability", () => {
  it("rejects a rate changed during direct booking but preserves an agreed request rate", async () => {
    const tx = { product: { update: vi.fn().mockResolvedValue({ price: new Prisma.Decimal(120), stockCount: 3, attributes: { rentalUnit: "HOUR" }, status: "ACTIVE" }) }, saleItem: { findMany: vi.fn().mockResolvedValue([]) } };
    const lines = [{ productId: "chairs", quantity: 1, rental: quoteRental("HOUR", "100", at(1), at(3)) }];
    await expect(reserveRentalCapacity(tx as never, lines, true)).rejects.toThrow("rate changed");
    await expect(reserveRentalCapacity(tx as never, lines, false)).resolves.toBeUndefined();
  });
  it("charges whole started hours using exact decimal money", () => {
    const quote = quoteRental("HOUR", "10.25", at(1), new Date(at(3).getTime() + 1));
    expect(quote).toMatchObject({ units: 3, unitPrice: "30.75", rate: "10.25" });
  });
  it("charges elapsed 24-hour periods, including across dates and time zones", () => {
    expect(quoteRental("DAY", "2000", "2099-01-01T14:00:00+01:00", "2099-01-02T13:00:00Z").units).toBe(1);
    expect(quoteRental("DAY", "2000", "2099-01-01T13:00:00Z", "2099-01-02T13:01:00Z").unitPrice).toBe("4000.00");
  });
  it("rejects missing, reversed, ambiguous and excessively long periods", () => {
    for (const [start, end] of [[null, at(2)], [at(2), at(2)], [at(3), at(2)], ["2099-01-01T10:00", at(11)], [at(1), "2101-01-01T00:00:00Z"]]) {
      expect(() => rentalPeriod(start, end)).toThrow();
    }
  });
  it("snapshots policy and fee amounts and rounds only late time", () => {
    const policy = { rentalPolicy: "Return clean", rentalLateUnit: "HOUR", rentalLateRate: new Prisma.Decimal("2.25") };
    const quote = quoteRental("DAY", "100", at(1), at(2), policy);
    policy.rentalPolicy = "Changed later";
    expect(quote.policy).toBe("Return clean");
    expect(rentalLateFee(quote, 3, at(2)).amount.toString()).toBe("0");
    expect(rentalLateFee(quote, 3, new Date(at(2).getTime() + 1)).amount.toString()).toBe("6.75");
  });
  it("uses peak overlap, allowing adjacent bookings within a longer requested period", () => {
    expect(remainingRentalCapacity(5, at(1), at(7), [booking(1, 3, 3), booking(3, 5, 3), booking(5, 7, 2)], at(0))).toBe(2);
    expect(remainingRentalCapacity(5, at(1), at(7), [booking(1, 4, 3), booking(3, 5, 2)], at(0))).toBe(0);
  });
  it("releases returned items but retains overdue received or dispatched items", () => {
    const rows = [{ ...booking(1, 3, 2), rentalReceivedAt: at(1) }, { ...booking(1, 3, 1), rentalDispatchedAt: at(1) }];
    expect(remainingRentalCapacity(5, at(6), at(9), rows, at(5))).toBe(2);
    expect(remainingRentalCapacity(5, at(6), at(9), rows.map(row => ({ ...row, rentalReturnedAt: at(4) })), at(5))).toBe(5);
  });
  it("requires explicit rental mode and finite capacity, preventing metadata bypasses", () => {
    expect(productSupply({ attributes: { rentalUnit: "DAY" }, stockCount: 0 }).attributes.rentalUnit).toBe("NONE");
    expect(() => productSupply({ rentalUnit: "DAY" })).toThrow("at least one");
    expect(() => productSupply({ rentalUnit: "DAY", stockCount: 1, madeToOrder: true })).toThrow();
    expect(productSupply({ rentalUnit: "HOUR", stockCount: 4 })).toMatchObject({ madeToOrder: false, stockCount: 4, attributes: { rentalUnit: "HOUR" } });
  });
  it("serializes reservations on a product and rejects duplicate lines exceeding capacity", async () => {
    const tx = { product: { update: vi.fn().mockResolvedValue({ stockCount: 3, attributes: { rentalUnit: "HOUR" }, status: "ACTIVE", name: "Chairs" }) }, saleItem: { findMany: vi.fn().mockResolvedValue([]) } };
    const rental = quoteRental("HOUR", "100", at(1), at(3));
    await expect(reserveRentalCapacity(tx as never, [{ productId: "chairs", quantity: 2, rental }, { productId: "chairs", quantity: 2, rental }])).rejects.toThrow("enough items");
    expect(tx.product.update).toHaveBeenCalledTimes(1);
    expect(tx.product.update.mock.calls[0][0].data).not.toHaveProperty("stockCount");
  });
  it("combines pending and existing intervals without falsely summing disjoint peaks", async () => {
    const tx = { product: { update: vi.fn().mockResolvedValue({ stockCount: 3, attributes: { rentalUnit: "HOUR" }, status: "ACTIVE" }) }, saleItem: { findMany: vi.fn().mockResolvedValue([booking(1, 3, 2)]) } };
    await expect(reserveRentalCapacity(tx as never, [
      { productId: "chairs", quantity: 2, rental: quoteRental("HOUR", "100", at(3), at(5)) },
      { productId: "chairs", quantity: 1, rental: quoteRental("HOUR", "100", at(1), at(5)) },
    ])).resolves.toBeUndefined();
  });
});
