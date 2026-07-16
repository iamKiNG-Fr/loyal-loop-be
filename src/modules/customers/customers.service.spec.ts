import { describe, expect, it, vi } from "vitest";
import { CustomersService } from "./customers.service";

describe("CustomersService customer briefs", () => {
  it("reuses a business-scoped brief until the customer evidence changes", async () => {
    const customer = {
      id: "customer-1",
      name: "Amaka Okafor",
      channel: "WHATSAPP",
      business: { id: "business-1", name: "King's Store", category: "Retail" },
      tagAssignments: [{ tag: { name: "Perfume buyer" } }],
    };
    let cached: Record<string, unknown> | null = null;
    let sales: Array<Record<string, unknown>> = [];
    const summarizeCustomer = vi.fn(async () => ({
      actionReason: "A completed purchase is a timely reason to follow up.",
      evidenceIds: sales.length ? ["sale:sale-1"] : [],
      headline: "A useful customer relationship",
      overview: "This brief is grounded in the current business context.",
      recommendedAction: "Send a relevant follow-up.",
      source: "ai" as const,
    }));
    const emptyFindMany = vi.fn(async () => []);
    const prisma = {
      $transaction: async (queries: Array<Promise<unknown>>) => Promise.all(queries),
      activityEvent: { findMany: emptyFindMany },
      customer: { findFirst: vi.fn(async () => customer) },
      customerFeedback: { findMany: emptyFindMany },
      customerInsightSummary: {
        findFirst: vi.fn(async () => cached),
        updateMany: vi.fn(async () => ({ count: 1 })),
        upsert: vi.fn(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
          cached = cached
            ? { ...cached, ...update }
            : { id: "brief-1", generatedAt: new Date(), staleAt: null, ...create };
          return cached;
        }),
      },
      customerIssue: { findMany: emptyFindMany },
      customerNote: { findMany: emptyFindMany },
      delivery: { findMany: emptyFindMany },
      sale: { findMany: vi.fn(async () => sales) },
    };
    const service = new CustomersService(prisma as never, {} as never, {
      model: "gemini-2.5-flash",
      summarizeCustomer,
    } as never);
    const auth = { businessId: "business-1" } as never;

    expect((await service.insight(auth, "customer-1")).needsRefresh).toBe(true);
    const first = await service.refreshInsight(auth, "customer-1");
    expect(first.needsRefresh).toBe(false);
    expect(summarizeCustomer).toHaveBeenCalledTimes(1);
    expect(summarizeCustomer).toHaveBeenCalledWith(expect.objectContaining({
      businessName: "King's Store",
      customerName: "Amaka Okafor",
      customerLabels: ["Perfume buyer"],
    }));

    await service.refreshInsight(auth, "customer-1");
    expect(summarizeCustomer).toHaveBeenCalledTimes(1);

    sales = [{
      id: "sale-1",
      referenceCode: "LL-2051",
      status: "COMPLETED",
      paymentStatus: "PAID",
      total: 44500,
      currency: "NGN",
      soldAt: new Date("2026-07-16T10:00:00.000Z"),
    }];
    expect((await service.insight(auth, "customer-1")).needsRefresh).toBe(true);
    await service.refreshInsight(auth, "customer-1");
    expect(summarizeCustomer).toHaveBeenCalledTimes(2);
  });
});
