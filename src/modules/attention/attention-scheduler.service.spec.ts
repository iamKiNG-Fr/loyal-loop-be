import { describe, expect, it } from "vitest";
import { digestDue, withinOwnerPushWindow } from "./attention-scheduler.service";

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
