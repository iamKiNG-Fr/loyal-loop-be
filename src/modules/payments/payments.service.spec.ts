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

describe("PaymentsService payment-proof rejection", () => {
  const auth = { businessId: "business-1", userId: "owner-1" };

  it("requires a customer-safe reason before rejecting a proof", async () => {
    const prisma = {
      paymentProof: {
        findFirst: vi.fn().mockResolvedValue({
          id: "proof-1",
          status: "SUBMITTED",
          sale: { sourceRequest: null },
        }),
      },
      $transaction: vi.fn(),
    };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      {} as MediaService,
      {} as ActivityService,
      {} as MessagingService,
      {} as never,
    );

    await expect(
      service.reviewProof(auth, "proof-1", { decision: "REJECTED", note: "   " }),
    ).rejects.toThrow("Tell the customer what needs to be corrected");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("records the reason, creates a customer notice, and queues a WhatsApp update", async () => {
    const proof = {
      amount: new Prisma.Decimal(45_000),
      id: "proof-1",
      reference: "BANK-REF",
      saleId: "sale-1",
      status: "SUBMITTED",
      sale: {
        amountPaid: new Prisma.Decimal(0),
        customerId: "customer-1",
        referenceCode: "LL-ORDER-1",
        total: new Prisma.Decimal(45_000),
        sourceRequest: {
          customerAccountId: "account-1",
          id: "request-1",
          referenceCode: "REQ-ORDER-1",
        },
      },
    };
    const updated = { ...proof, reviewNote: "The amount does not match", status: "REJECTED" };
    const tx = {
      customerOrderNotice: { create: vi.fn().mockResolvedValue({ id: "notice-1" }) },
      paymentProof: { update: vi.fn().mockResolvedValue(updated) },
    };
    const prisma = {
      paymentProof: { findFirst: vi.fn().mockResolvedValue(proof) },
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const activity = { record: vi.fn().mockResolvedValue(undefined) };
    const messaging = {
      enqueuePaymentProofRejected: vi.fn().mockResolvedValue({ status: "PENDING" }),
    };
    const service = new PaymentsService(
      prisma as unknown as PrismaService,
      { protectAsset: vi.fn((asset) => asset) } as unknown as MediaService,
      activity as unknown as ActivityService,
      messaging as unknown as MessagingService,
      {} as never,
    );

    await expect(
      service.reviewProof(auth, "proof-1", {
        decision: "REJECTED",
        note: "  The amount does not match  ",
      }),
    ).resolves.toMatchObject({
      rejectionDelivery: { status: "PENDING" },
      reviewNote: "The amount does not match",
      status: "REJECTED",
    });
    expect(tx.paymentProof.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reviewNote: "The amount does not match", status: "REJECTED" }),
    }));
    expect(tx.customerOrderNotice.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actionRequired: true,
        customerAccountId: "account-1",
        message: expect.stringContaining("The amount does not match"),
        orderRequestId: "request-1",
        type: "PAYMENT_UPDATED",
      }),
    });
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "customer-1",
        description: "The amount does not match",
        type: "PAYMENT_UPDATED",
      }),
      tx,
    );
    expect(messaging.enqueuePaymentProofRejected).toHaveBeenCalledWith(
      "request-1",
      "proof-1",
      "The amount does not match",
    );
  });
});
