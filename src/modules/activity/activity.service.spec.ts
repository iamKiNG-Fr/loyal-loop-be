import { describe, expect, it, vi } from "vitest";
import { ActivityService, TRUST_POINTS, activityTarget } from "./activity.service";

describe("ActivityService", () => {
  it("creates the trust award from a server-authored activity event", async () => {
    const client = {
      activityEvent: {
        create: vi.fn().mockResolvedValue({ id: "event-1" }),
      },
      trustLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: "award-1" }),
      },
    };
    const service = new ActivityService(client as never);

    await service.record(
      {
        businessId: "business-1",
        type: "DELIVERY_CONFIRMED",
        title: "Confirmed",
      },
      client as never,
    );

    expect(client.trustLedgerEntry.create).toHaveBeenCalledWith({
      data: {
        businessId: "business-1",
        activityEventId: "event-1",
        ruleKey: TRUST_POINTS.DELIVERY_CONFIRMED.key,
        points: 20,
      },
    });
  });

  it("does not award points when the caller explicitly disables it", async () => {
    const client = {
      activityEvent: {
        create: vi.fn().mockResolvedValue({ id: "event-1" }),
      },
      trustLedgerEntry: { create: vi.fn() },
    };
    const service = new ActivityService(client as never);
    await service.record(
      {
        businessId: "business-1",
        type: "RECEIPT_SENT",
        title: "Sent",
        awardTrust: false,
      },
      client as never,
    );
    expect(client.trustLedgerEntry.create).not.toHaveBeenCalled();
  });
});

const baseEntry = {
  customerId: null,
  deliveryId: null,
  metadata: null,
  receiptId: null,
  saleId: null,
  type: "CUSTOMER_ADDED" as const,
};

describe("activityTarget", () => {
  it("opens deliveries in the existing delivery workspace", () => {
    expect(activityTarget({ ...baseEntry, deliveryId: "delivery/1" }))
      .toBe("/dashboard/deliveries?delivery=delivery%2F1");
  });

  it("opens receipt activity through its existing sale detail", () => {
    expect(activityTarget({
      ...baseEntry,
      receiptId: "receipt-1",
      saleId: "sale-1",
      type: "RECEIPT_SENT",
    })).toBe("/dashboard/sales/sale-1");
  });

  it("opens product and customer records through supported query routes", () => {
    expect(activityTarget({
      ...baseEntry,
      metadata: { productId: "product/1" },
      type: "PRODUCT_UPDATED",
    })).toBe("/dashboard/products?product=product%2F1");
    expect(activityTarget({ ...baseEntry, customerId: "customer/1" }))
      .toBe("/dashboard/customers?customer=customer%2F1");
  });

  it("routes care milestones to trust and falls back to the dashboard", () => {
    expect(activityTarget({ ...baseEntry, type: "INVENTORY_CHECKED" }))
      .toBe("/dashboard/trust-rewards");
    expect(activityTarget(baseEntry)).toBe("/dashboard");
  });
});
