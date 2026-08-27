import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../generated/prisma/client";
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
      {} as never,
      { captureIfQualified: vi.fn() } as never,
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

  it("queues an opted-in customer-memory prompt after confirmation commits", async () => {
    const delivery = {
      id: "delivery-1",
      businessId: "business-1",
      customerId: "customer-1",
      journeyMethod: "CUSTOMER_RIDER",
      saleId: "sale-1",
      status: "IN_TRANSIT",
    };
    const updated = { ...delivery, status: "CONFIRMED" };
    const tx = {
      delivery: { update: vi.fn().mockResolvedValue(updated) },
    };
    const prisma = {
      delivery: { findFirst: vi.fn().mockResolvedValue(delivery) },
      deliveryShareToken: { findFirst: vi.fn() },
      orderRequest: { findFirst: vi.fn() },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const activity = { record: vi.fn().mockResolvedValue(undefined) };
    const messaging = { enqueueCustomerMemoryPrompt: vi.fn().mockResolvedValue({ status: "PENDING" }) };
    const valueFeedback = { captureIfQualified: vi.fn().mockResolvedValue(undefined) };
    const service = new DeliveryService(
      prisma as unknown as PrismaService,
      activity as unknown as ActivityService,
      messaging as unknown as MessagingService,
      {} as never,
      valueFeedback as never,
    );

    await expect(service.confirm("account-1", "customer-token")).resolves.toEqual(updated);
    expect(messaging.enqueueCustomerMemoryPrompt).toHaveBeenCalledWith("delivery-1");
    expect(valueFeedback.captureIfQualified).toHaveBeenCalledWith(prisma, "business-1", "sale-1");
    expect(activity.record).toHaveBeenCalledOnce();
  });
});

describe("DeliveryService in-transit courier details", () => {
  const auth = { businessId: "business-1", userId: "owner-1" };
  const delivery = {
    businessId: "business-1",
    courierName: null,
    courierPhone: null,
    courierService: null,
    customerId: "customer-1",
    deliveredAt: null,
    id: "delivery-1",
    journeyMethod: "SHOP_DELIVERY",
    saleId: "sale-1",
    status: "READY_FOR_PICKUP",
    sale: { amountPaid: new Prisma.Decimal(0) },
  };

  it("does not move an order in transit without a service and rider contact", async () => {
    const prisma = {
      delivery: { findFirst: vi.fn().mockResolvedValue(delivery) },
      $transaction: vi.fn(),
    };
    const service = new DeliveryService(
      prisma as unknown as PrismaService,
      {} as ActivityService,
      {} as MessagingService,
      {} as never,
      { captureIfQualified: vi.fn() } as never,
    );

    await expect(
      service.update(auth, "delivery-1", { status: "IN_TRANSIT" }),
    ).rejects.toThrow("Add the delivery service, rider name, rider phone");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("keeps direct customer pickup out of in-transit and delivered states", async () => {
    const directPickup = {
      ...delivery,
      journeyMethod: "CUSTOMER_PICKUP",
    };
    const prisma = {
      delivery: { findFirst: vi.fn().mockResolvedValue(directPickup) },
      $transaction: vi.fn(),
    };
    const service = new DeliveryService(
      prisma as unknown as PrismaService,
      {} as ActivityService,
      {} as MessagingService,
      {} as never,
      { captureIfQualified: vi.fn() } as never,
    );

    await expect(
      service.update(auth, "delivery-1", { status: "IN_TRANSIT" }),
    ).rejects.toThrow("customer pickup journey cannot move");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("accepts shop delivery without requiring a tracking code or link", async () => {
    const updated = {
      ...delivery,
      courierName: "Tobi",
      courierPhone: "+2348012345678",
      courierService: "Shop delivery",
      status: "IN_TRANSIT",
    };
    const tx = {
      delivery: { update: vi.fn().mockResolvedValue(updated) },
    };
    const prisma = {
      delivery: { findFirst: vi.fn().mockResolvedValue(delivery) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const activity = { record: vi.fn().mockResolvedValue(undefined) };
    const messaging = { enqueueDelivery: vi.fn().mockResolvedValue({ status: "PENDING" }) };
    const service = new DeliveryService(
      prisma as unknown as PrismaService,
      activity as unknown as ActivityService,
      messaging as unknown as MessagingService,
      {} as never,
      { captureIfQualified: vi.fn() } as never,
    );

    await expect(
      service.update(auth, "delivery-1", {
        courierName: "Tobi",
        courierPhone: "+2348012345678",
        courierService: "Shop delivery",
        status: "IN_TRANSIT",
      }),
    ).resolves.toEqual(updated);
    expect(tx.delivery.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        courierName: "Tobi",
        courierPhone: "+2348012345678",
        courierService: "Shop delivery",
        status: "IN_TRANSIT",
        trackingCode: undefined,
        trackingUrl: undefined,
      }),
    }));
    expect(messaging.enqueueDelivery).toHaveBeenCalledWith(auth, "delivery-1");
  });
});
