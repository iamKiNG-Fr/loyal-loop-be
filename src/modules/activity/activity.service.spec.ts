import { describe, expect, it, vi } from "vitest";
import { ActivityService, TRUST_POINTS } from "./activity.service";

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
