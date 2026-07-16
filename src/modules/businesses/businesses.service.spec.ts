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
  let otpProvider: { start: ReturnType<typeof vi.fn>; verify: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = prismaMock();
    prisma.$transaction.mockImplementation(async (callback: unknown) =>
      typeof callback === "function"
        ? (callback as (client: typeof prisma) => unknown)(prisma)
        : callback,
    );
    otpProvider = { start: vi.fn(), verify: vi.fn() };
    service = new BusinessesService(
      prisma as never,
      new ConfigService({ APP_URL: "https://www.useloyalloop.com" }),
      otpProvider,
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

  it("refuses to replace the owner WhatsApp number without a verified proof", async () => {
    prisma.business.findUniqueOrThrow.mockResolvedValue({
      ownerId: auth.userId,
      owner: { phone: "+2348011111111" },
    });

    await expect(service.replaceContacts(auth, {
      contacts: [{ platform: "WHATSAPP", value: "+2348022222222", isPrimary: true }],
    })).rejects.toThrow("Verify the replacement WhatsApp number before saving contacts");

    expect(prisma.businessContact.deleteMany).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("atomically consumes the matching proof before replacing the number", async () => {
    prisma.business.findUniqueOrThrow.mockResolvedValue({
      ownerId: auth.userId,
      owner: { phone: "+2348011111111" },
    });
    prisma.ownerOtpChallenge.updateMany.mockResolvedValue({ count: 1 });
    prisma.businessContact.findMany.mockResolvedValue([
      { platform: "WHATSAPP", value: "+2348022222222", isPrimary: true },
    ]);

    await service.replaceContacts(auth, {
      contacts: [{ platform: "WHATSAPP", value: "+2348022222222", isPrimary: true }],
      phoneVerificationChallengeId: "verified-proof-1",
    });

    expect(prisma.ownerOtpChallenge.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "verified-proof-1",
        phone: "+2348022222222",
        userId: auth.userId,
        verifiedAt: { not: null },
      }),
      data: { expiresAt: expect.any(Date) },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: auth.userId },
      data: { phone: "+2348022222222" },
    });
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
    businessContact: {
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
    },
    ownerOtpChallenge: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    product: {
      findFirst: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return client;
}
