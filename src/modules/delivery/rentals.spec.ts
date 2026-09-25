import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../generated/prisma/client";
import { quoteRental } from "../../common/rental";
import { DeliveryService } from "./delivery.service";

function fixture() {
  const terms = quoteRental("DAY", "1000", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z", { rentalLateUnit: "DAY", rentalLateRate: "10" });
  const item: any = { id: "item", saleId: "sale", name: "Chairs", quantity: 2, rental: terms, rentalStartAt: new Date(terms.startAt), rentalReceivedAt: new Date(terms.startAt), rentalReturnedAt: null };
  const sale = { id: "sale", status: "COMPLETED", paymentStatus: "PAID", total: new Prisma.Decimal(2000), subtotal: new Prisma.Decimal(2000), amountPaid: new Prisma.Decimal(2000), currency: "NGN" };
  const delivery = { id: "journey", saleId: "sale", businessId: "shop", status: "CONFIRMED", sale, journeyMethod: "CUSTOMER_PICKUP" };
  const prisma: any = {
    delivery: { findFirst: vi.fn().mockResolvedValue(delivery), findUniqueOrThrow: vi.fn().mockResolvedValue(delivery) },
    saleItem: { findFirst: vi.fn().mockResolvedValue(item), findUniqueOrThrow: vi.fn().mockResolvedValue(item), findMany: vi.fn().mockResolvedValue([]), update: vi.fn(async ({ data }) => Object.assign(item, data)), create: vi.fn() },
    sale: { findUniqueOrThrow: vi.fn().mockResolvedValue(sale), update: vi.fn() }, deliveryEvent: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn((run: any) => run(prisma));
  const media = { registerRentalAsset: vi.fn().mockResolvedValue({ id: "return-photo" }), protectAsset: vi.fn((asset: any) => ({ ...asset, secureUrl: "signed-private-link" })) };
  const service = new DeliveryService(prisma, {} as never, {} as never, {} as never, {} as never, media as never);
  return { service, prisma, media, item, sale, delivery };
}
const auth: any = { businessId: "shop", userId: "owner" };

describe("rental receipt and return", () => {
  it("adds a reviewed late fee once to the ordinary ledger without charging a provider", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-03T01:00:00Z"));
    try {
      const { service, prisma, item } = fixture();
      await service.returnRental(auth, "journey", "item", { applyLateFee: true, expectedLateFee: "40.00" } as never);
      expect(item.rentalLateFee.toString()).toBe("40");
      const update = prisma.sale.update.mock.calls[0][0].data;
      expect(update.total.toString()).toBe("2040"); expect(update.subtotal.toString()).toBe("2040");
      expect(update.paymentStatus).toBe("PARTIAL"); expect(update).not.toHaveProperty("amountPaid");
      expect(prisma.saleItem.create.mock.calls[0][0].data.total.toString()).toBe("40");
      await service.returnRental(auth, "journey", "item", { applyLateFee: true, expectedLateFee: "40.00" } as never);
      expect(prisma.sale.update).toHaveBeenCalledTimes(1); expect(prisma.saleItem.create).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it("records customer receipt only on the exact account-owned journey and item", async () => {
    const { service, prisma, item, sale, delivery, media } = fixture();
    item.rentalReceivedAt = null; item.sale = sale; delivery.status = "READY_FOR_PICKUP";
    prisma.saleItem.updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await service.receiveRental("customer", "token", "item", {} as never);
    expect(prisma.delivery.findFirst.mock.calls[0][0].where.OR).toEqual([{ customer: { accountId: "customer" } }, { sale: { sourceRequest: { customerAccountId: "customer" } } }]);
    expect(prisma.saleItem.findFirst).toHaveBeenCalledWith({ where: { id: "item", saleId: "sale", rentalStartAt: { not: null } }, include: { sale: true } });
    expect(media.registerRentalAsset).toHaveBeenCalledWith("shop", "item", "receive", {});
    expect(prisma.saleItem.updateMany.mock.calls[0][0].data.rentalReceiveAssetId).toBe("return-photo");
  });
  it("scopes owner returns to their business and the exact sale item", async () => {
    const { service, prisma } = fixture(); prisma.delivery.findFirst.mockResolvedValue(null);
    await expect(service.returnRental(auth, "foreign", "item", {} as never)).rejects.toThrow("not found");
    expect(prisma.delivery.findFirst).toHaveBeenCalledWith({ where: { id: "foreign", businessId: "shop" } });
    expect(prisma.saleItem.update).not.toHaveBeenCalled();
  });
  it("records a waived late fee, attaches its photo and safely replays without a second write", async () => {
    const { service, prisma, media, item } = fixture();
    await service.returnRental(auth, "journey", "item", { applyLateFee: false } as never);
    expect(item.rentalReturnAssetId).toBe("return-photo"); expect(item.rentalLateFee.toString()).toBe("0");
    expect(item.rentalReturnedAt).toBeInstanceOf(Date);
    await service.returnRental(auth, "journey", "item", { applyLateFee: true } as never);
    expect(media.registerRentalAsset).toHaveBeenCalledTimes(1);
    expect(prisma.sale.update).not.toHaveBeenCalled(); expect(prisma.saleItem.update).toHaveBeenCalledTimes(1);
  });
  it("requires the reviewed amount before adding a late fee", async () => {
    const { service, prisma } = fixture();
    await expect(service.returnRental(auth, "journey", "item", { applyLateFee: true, expectedLateFee: "0" } as never)).rejects.toThrow("late fee changed");
    expect(prisma.saleItem.update).not.toHaveBeenCalled();
  });
  it("cannot re-open a refunded order with a late fee", async () => {
    const { service, sale, prisma } = fixture(); sale.paymentStatus = "REFUNDED";
    await expect(service.returnRental(auth, "journey", "item", { applyLateFee: true } as never)).rejects.toThrow("without a late fee");
    expect(prisma.sale.update).not.toHaveBeenCalled();
  });
  it("requires a receipt photo before final handoff confirmation", async () => {
    const { service, prisma, sale } = fixture();
    prisma.sale.findUniqueOrThrow.mockResolvedValue({ ...sale, items: [{ rentalStartAt: new Date(), rentalReceiveAssetId: null }] });
    await expect((service as any).assertPaymentSettled(prisma, "sale")).rejects.toThrow("photo of each rental");
  });
  it("does not allow the customer to submit a receipt photo before the handoff stage", async () => {
    const { service, delivery, item, media } = fixture(); delivery.status = "PREPARING"; item.sale = fixture().sale;
    await expect(service.receiveRental("customer", "token", "item", {} as never)).rejects.toThrow("wait for the rental handoff");
    expect(media.registerRentalAsset).not.toHaveBeenCalled();
  });
});
