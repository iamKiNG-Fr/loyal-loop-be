import { describe, expect, it, vi } from "vitest";
import { AttentionSchedulerService, digestDue, withinOwnerPushWindow } from "./attention-scheduler.service";

const preference = {
  timezone: "Africa/Lagos",
  dailyDigestTime: "08:00",
  dailyDigestWeekdays: [1, 2, 3, 4, 5],
  lastDailyDigestAt: null as Date | null,
};

describe("owner reminder schedule", () => {
  it("uses the business timezone and selected weekdays", () => {
    expect(digestDue(preference, new Date("2026-08-03T07:05:00.000Z"))).toBe(true);
    expect(digestDue(preference, new Date("2026-08-02T07:05:00.000Z"))).toBe(false);
  });

  it("allows a bounded catch-up window and suppresses a duplicate business day", () => {
    expect(digestDue(preference, new Date("2026-08-03T09:59:00.000Z"))).toBe(true);
    expect(digestDue(preference, new Date("2026-08-03T10:00:00.000Z"))).toBe(false);
    expect(digestDue({
      ...preference,
      lastDailyDigestAt: new Date("2026-08-03T07:01:00.000Z"),
    }, new Date("2026-08-03T07:10:00.000Z"))).toBe(false);
  });

  it("keeps unscheduled urgent push out of the owner's quiet hours", () => {
    expect(withinOwnerPushWindow("Africa/Lagos", new Date("2026-08-03T06:00:00.000Z"))).toBe(true);
    expect(withinOwnerPushWindow("Africa/Lagos", new Date("2026-08-03T20:30:00.000Z"))).toBe(false);
  });
});

describe("product launch reminders", () => {
  it("queues a launch message only from the consent-filtered wishlist selection", async () => {
    const launchAt = new Date("2026-08-15T12:00:00.000Z");
    const productFindMany = vi.fn().mockResolvedValue([{
      business: { id: "business-1", name: "King's Store", slug: "kings-store" },
      id: "product-1",
      launchAt,
      name: "Ankara Haven",
      wishlistItems: [{ customerAccount: { id: "customer-1", name: "Ada", phone: "+2348012345678" } }],
    }]);
    const enqueueProductLaunch = vi.fn().mockResolvedValue({ status: "PENDING" });
    const service = new AttentionSchedulerService(
      { businessPreferences: { findMany: vi.fn().mockResolvedValue([]) }, product: { findMany: productFindMany } } as never,
      { get: vi.fn((key: string, fallback?: string) => key === "APP_URL" ? "https://www.useloyalloop.com" : fallback) } as never,
      {} as never,
      { enqueueProductLaunch } as never,
      {} as never,
    );

    const result = await service.run(new Date("2026-08-15T12:05:00.000Z"));

    expect(productFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        wishlistItems: { some: { customerAccount: { messagingConsents: { some: { purpose: "REMINDER", revokedAt: null } } } } },
      }),
    }));
    expect(enqueueProductLaunch).toHaveBeenCalledWith(expect.objectContaining({
      customerAccountId: "customer-1",
      productId: "product-1",
      url: "https://www.useloyalloop.com/shop/kings-store?product=product-1",
    }));
    expect(result.launchRemindersQueued).toBe(1);
  });
});
