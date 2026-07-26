import { describe, expect, it, vi } from "vitest";
import type { ActivityService } from "../activity/activity.service";
import type { MessagingService } from "../messaging/messaging.service";
import type { PrismaService } from "../prisma/prisma.service";
import { DeliveryService } from "./delivery.service";

describe("DeliveryService customer journey access", () => {
  it("accepts the authenticated account that created the converted request", async () => {
    const customerAccountId = "account-1";
    const delivery = {
      id: "delivery-1",
      status: "CONFIRMED",
    };
    const findFirst = vi.fn().mockResolvedValue(delivery);
    const prisma = {
      delivery: {
        findFirst,
        findUniqueOrThrow: vi.fn().mockResolvedValue(delivery),
      },
      deliveryShareToken: {
        findFirst: vi.fn(),
      },
      orderRequest: {
        findFirst: vi.fn(),
      },
    };
    const service = new DeliveryService(
      prisma as unknown as PrismaService,
      {} as ActivityService,
      {} as MessagingService,
    );

    await expect(service.confirm(customerAccountId, "customer-token")).resolves.toEqual(delivery);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        tokenHash: expect.any(String),
        OR: [
          { customer: { accountId: customerAccountId } },
          { sale: { sourceRequest: { customerAccountId } } },
        ],
      },
    });
  });
});
