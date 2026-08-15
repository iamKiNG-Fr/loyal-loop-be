import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../generated/prisma/client";
import type { ActivityService } from "../activity/activity.service";
import type { MediaService } from "../media/media.service";
import type { MessagingService } from "../messaging/messaging.service";
import type { PrismaService } from "../prisma/prisma.service";
import { PaymentsService } from "./payments.service";

describe("PaymentsService converted-request access", () => {
  it("accepts a delivery token when the signed-in account owns the source request", async () => {
    const sale = {
      amountPaid: new Prisma.Decimal(0),
      businessId: "business-1",
      id: "sale-1",
      paymentInstruction: { method: "BANK_TRANSFER" },
      paymentProofs: [],
      total: new Prisma.Decimal(100),
    };
    const findFirst = vi.fn().mockResolvedValue({ sale });
    const createPaymentProofUploadSignature = vi.fn().mockResolvedValue({ signature: "signed" });
    const prisma = {
      delivery: { findFirst },
      deliveryShareToken: { findFirst: vi.fn() },
      orderRequest: { findFirst: vi.fn() },
    };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      { createPaymentProofUploadSignature } as unknown as MediaService,
      {} as ActivityService,
      {} as MessagingService,
    );

    await expect(
      service.createUploadSignature("delivery", "account-1", "delivery-token"),
    ).resolves.toEqual({ signature: "signed" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tokenHash: expect.any(String),
        OR: [
          { customer: { accountId: "account-1" } },
          { sale: { sourceRequest: { customerAccountId: "account-1" } } },
        ],
      },
    }));
  });

  it("accepts an active request share token for a converted sale", async () => {
    const sale = {
      amountPaid: new Prisma.Decimal(0),
      businessId: "business-1",
      id: "sale-1",
      paymentInstruction: { method: "BANK_TRANSFER" },
      paymentProofs: [],
      total: new Prisma.Decimal(100),
    };
    const findFirst = vi.fn().mockResolvedValue({ convertedSale: sale });
    const createPaymentProofUploadSignature = vi.fn().mockResolvedValue({ signature: "signed" });
    const prisma = {
      delivery: { findFirst: vi.fn().mockResolvedValue(null) },
      deliveryShareToken: { findFirst: vi.fn().mockResolvedValue(null) },
      orderRequest: { findFirst },
    };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      { createPaymentProofUploadSignature } as unknown as MediaService,
      {} as ActivityService,
      {} as MessagingService,
    );

    await expect(
      service.createUploadSignature("delivery", "account-1", "shared-token"),
    ).resolves.toEqual({ signature: "signed" });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        customerAccountId: "account-1",
        OR: [
          { tokenHash: expect.any(String) },
          {
            shareTokens: {
              some: { tokenHash: expect.any(String), revokedAt: null },
            },
          },
        ],
      },
      include: {
        convertedSale: {
          include: { paymentInstruction: true, paymentProofs: true },
        },
      },
    });
    expect(createPaymentProofUploadSignature).toHaveBeenCalledWith(
      "business-1",
      "sale-1",
    );
  });
});
