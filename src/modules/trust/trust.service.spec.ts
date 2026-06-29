import { describe, expect, it } from "vitest";
import {
  calculateLoyaltyHealth,
  calculateTrustLevel,
  currentStreak,
  uniqueBusinessDays,
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
});
