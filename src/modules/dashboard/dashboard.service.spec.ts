import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardService } from "./dashboard.service";

function createPrisma() {
  return {
    activityEvent: { findMany: vi.fn().mockResolvedValue([]) },
    businessPreferences: { findUnique: vi.fn().mockResolvedValue({ lowStockThreshold: 5 }) },
    commerceEvent: { findMany: vi.fn().mockResolvedValue([]) },
    customer: { count: vi.fn().mockResolvedValue(2) },
    customerIssue: { count: vi.fn().mockResolvedValue(0) },
    delivery: { count: vi.fn().mockResolvedValue(1) },
    followUpSuggestion: { findMany: vi.fn().mockResolvedValue([]) },
    orderRequest: { count: vi.fn().mockResolvedValue(0) },
    paymentProof: { count: vi.fn().mockResolvedValue(0) },
    product: {
      count: vi.fn().mockResolvedValue(3),
      findMany: vi.fn().mockResolvedValue([]),
    },
    receipt: { findMany: vi.fn().mockResolvedValue([]) },
    sale: { findMany: vi.fn().mockResolvedValue([]) },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("DashboardService", () => {
  it("returns the core dashboard when optional discovery analytics are unavailable", async () => {
    const prisma = createPrisma();
    prisma.commerceEvent.findMany.mockRejectedValue(new Error("analytics schema unavailable"));
    const warning = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const attention = { get: vi.fn().mockResolvedValue({ alerts: [], tasks: [], unseenCount: 0 }) };
    const service = new DashboardService(prisma as never, attention as never);

    const dashboard = await service.get({
      businessId: "business-1",
      capabilities: [],
      memberId: "member-1",
      role: "OWNER",
      sessionId: "session-1",
      userId: "user-1",
    });

    expect(dashboard.counts).toMatchObject({ customers: 2, pendingDeliveries: 1, products: 3 });
    expect(dashboard.discovery).toMatchObject({
      attributedViews: 0,
      impressions: 0,
      productImpressions: 0,
      reportingReady: false,
      totalViews: 0,
    });
    expect(dashboard.attention).toMatchObject({ tasks: [], unseenCount: 0 });
    expect(warning).toHaveBeenCalledWith(
      "Dashboard discovery analytics are unavailable; returning core dashboard data.",
    );
  });
});
