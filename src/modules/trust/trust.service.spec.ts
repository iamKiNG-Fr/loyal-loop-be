import { describe, expect, it, vi } from "vitest";
import {
  calculateLoyaltyHealth,
  calculateTrustLevel,
  currentStreak,
  currentWorkingDayStreak,
  uniqueBusinessDays,
  TrustService,
} from "./trust.service";

describe("deterministic trust rules", () => {
  it("only reaches level five when every lower threshold is satisfied", () => {
    expect(
      calculateTrustLevel({
        profileComplete: true,
        sentReceipts: 5,
        confirmedDeliveries: 50,
        feedbackCount: 25,
        staleIssues: 0,
        repeatCustomers: 5,
        followUps: 10,
        activeDays: 90,
      }),
    ).toBe(5);

    expect(
      calculateTrustLevel({
        profileComplete: true,
        sentReceipts: 5,
        confirmedDeliveries: 50,
        feedbackCount: 25,
        staleIssues: 1,
        repeatCustomers: 5,
        followUps: 10,
        activeDays: 90,
      }),
    ).toBe(2);
  });

  it("does not let receipt activity alone raise the public trust level", () => {
    const foundation = {
      profileComplete: true,
      sentReceipts: 100,
      feedbackCount: 0,
      staleIssues: 0,
      repeatCustomers: 0,
      followUps: 0,
      activeDays: 1,
    };

    expect(
      calculateTrustLevel({
        ...foundation,
        confirmedDeliveries: 0,
      }),
    ).toBe(1);

    expect(
      calculateTrustLevel({
        ...foundation,
        confirmedDeliveries: 1,
      }),
    ).toBe(2);
  });

  it("uses the business timezone when collapsing activity days", () => {
    const days = uniqueBusinessDays(
      [
        new Date("2026-06-28T23:30:00.000Z"),
        new Date("2026-06-29T00:30:00.000Z"),
      ],
      "Africa/Lagos",
    );
    expect(days).toHaveLength(1);
  });

  it("calculates consecutive-day streaks and relationship health", () => {
    expect(
      currentStreak(
        ["2026-06-26", "2026-06-27", "2026-06-28"],
        "2026-06-28",
      ),
    ).toBe(3);
    expect(
      calculateLoyaltyHealth({
        completedSales: 10,
        customerCount: 5,
        repeatRate: 0.3,
        staleIssues: 0,
      }),
    ).toBe("HEALTHY");
  });

  it("skips scheduled off-days and gives the current working day a grace window", () => {
    expect(
      currentWorkingDayStreak(
        ["2026-07-30", "2026-07-31"],
        "2026-08-03",
        [1, 2, 3, 4, 5],
      ),
    ).toBe(2);
    expect(
      currentWorkingDayStreak(
        ["2026-07-30", "2026-07-31", "2026-08-03"],
        "2026-08-03",
        [1, 2, 3, 4, 5],
      ),
    ).toBe(3);
  });
});

describe("TrustService activity aggregation", () => {
  it("keeps exact day semantics while returning one bounded database rollup", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{
      activeDays: 92,
      careDays: ["2026-08-29", "2026-08-28"],
      customerCareCompletedToday: true,
      inventoryCheckedToday: false,
    }]);
    const service = new TrustService({ $queryRaw: queryRaw } as never, {} as never);

    const rollup = await (service as unknown as {
      activityRollup: (businessId: string) => Promise<{
        activeDays: number;
        careDays: string[];
        customerCareCompletedToday: boolean;
        inventoryCheckedToday: boolean;
      }>;
    }).activityRollup("business-1");

    expect(rollup).toEqual({
      activeDays: 92,
      careDays: ["2026-08-28", "2026-08-29"],
      customerCareCompletedToday: true,
      inventoryCheckedToday: false,
    });
    const query = queryRaw.mock.calls[0]?.[0] as { strings?: string[] };
    expect(query.strings?.join(" ")).toContain("COUNT(DISTINCT");
    expect(query.strings?.join(" ")).toContain("ARRAY_AGG");
    expect(query.strings?.join(" ")).toContain("INTERVAL '370 days'");
  });
});
