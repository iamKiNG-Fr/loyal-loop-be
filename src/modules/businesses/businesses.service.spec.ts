import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerAuthContext } from "../../common/request-context";
import { BusinessesService } from "./businesses.service";

const auth: OwnerAuthContext = {
  businessId: "business-1",
  role: "OWNER",
  sessionId: "session-1",
  userId: "user-1",
};

describe("BusinessesService launch lifecycle", () => {
  let prisma: ReturnType<typeof prismaMock>;
  let service: BusinessesService;

  beforeEach(() => {
    prisma = prismaMock();
    prisma.$transaction.mockImplementation(async (callback: unknown) =>
      typeof callback === "function"
        ? (callback as (client: typeof prisma) => unknown)(prisma)
        : callback,
    );
    service = new BusinessesService(
      prisma as never,
      new ConfigService({ APP_URL: "https://www.useloyalloop.com" }),
    );
  });

  it("schedules a future launch without opening the shop", async () => {
    prisma.business.findUniqueOrThrow.mockResolvedValue({
      storeStatus: "SETTING_UP",
    });
    prisma.business.update.mockResolvedValue({
      id: auth.businessId,
      storeStatus: "SCHEDULED",
    });

    const launchAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await service.scheduleLaunch(auth, {
      autoOpen: true,
      launchAt: launchAt.toISOString(),
      message: "The first drop is almost here.",
      template: "FIRST_DROP",
      timezone: "Africa/Lagos",
    });

    expect(result.storeStatus).toBe("SCHEDULED");
    expect(prisma.business.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          launchAutoOpen: true,
          launchTemplate: "FIRST_DROP",
          storeStatus: "SCHEDULED",
        }),
      }),
    );
    expect(prisma.activityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "SHOP_LAUNCH_SCHEDULED" }),
      }),
    );
  });

  it("requires explicit confirmation before manually opening an empty shop", async () => {
    prisma.business.findUniqueOrThrow.mockResolvedValue({
      launchedAt: null,
      storeStatus: "SETTING_UP",
    });
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.openShop(auth, { confirmEmpty: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  it("opens a due scheduled shop only when an orderable product exists", async () => {
    prisma.business.findUnique.mockResolvedValue({
      id: auth.businessId,
      launchAt: new Date(Date.now() - 60_000),
      launchAutoOpen: true,
      launchedAt: null,
      storeStatus: "SCHEDULED",
    });
    prisma.product.findFirst.mockResolvedValue({ id: "product-1" });
    prisma.business.updateMany.mockResolvedValue({ count: 1 });

    await expect(service.reconcileScheduledLaunch(auth.businessId)).resolves.toBe(true);
    expect(prisma.business.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ storeStatus: "OPEN" }),
      }),
    );
    expect(prisma.activityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: "SHOP_OPENED" }),
      }),
    );
  });

  it("keeps a due launch scheduled when no product is orderable", async () => {
    prisma.business.findUnique.mockResolvedValue({
      id: auth.businessId,
      launchAt: new Date(Date.now() - 60_000),
      launchAutoOpen: true,
      launchedAt: null,
      storeStatus: "SCHEDULED",
    });
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.reconcileScheduledLaunch(auth.businessId)).resolves.toBe(false);
    expect(prisma.business.updateMany).not.toHaveBeenCalled();
  });
});

function prismaMock() {
  const client = {
    activityEvent: {
      create: vi.fn(),
    },
    business: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    product: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return client;
}
