import { describe, expect, it, vi } from "vitest";
import { FoundingValueFeedbackService } from "./founding-value-feedback.service";

function fixture() {
  const prisma = {
    business: { findFirst: vi.fn() },
    sale: { count: vi.fn(), findFirst: vi.fn() },
    foundingValueFeedback: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    prisma,
    service: new FoundingValueFeedbackService(prisma as never),
  };
}

describe("Founding value feedback", () => {
  it("creates one pending opportunity for a fully paid catalogue sale", async () => {
    const { prisma, service } = fixture();
    prisma.business.findFirst.mockResolvedValue({
      id: "business-1",
      foundingEnrollment: { id: "enrollment-1" },
    });
    prisma.sale.findFirst.mockResolvedValue({ id: "sale-1" });
    prisma.sale.count.mockResolvedValue(1);
    prisma.foundingValueFeedback.findFirst.mockResolvedValue(null);
    prisma.foundingValueFeedback.create.mockResolvedValue({
      id: "feedback-1",
      status: "PENDING",
    });

    await expect(
      service.captureIfQualified(prisma as never, "business-1", "sale-1"),
    ).resolves.toMatchObject({ id: "feedback-1", status: "PENDING" });
    expect(prisma.foundingValueFeedback.create).toHaveBeenCalledWith({
      data: {
        businessId: "business-1",
        deferralCount: 0,
        enrollmentId: "enrollment-1",
        triggerSaleId: "sale-1",
        triggerSaleSequence: 1,
      },
    });
  });

  it("requires a reason when the owner chooses not right now", async () => {
    const { prisma, service } = fixture();
    prisma.foundingValueFeedback.findFirst.mockResolvedValue({
      id: "feedback-1",
      businessId: "business-1",
      status: "PENDING",
    });

    await expect(service.submit("business-1", "feedback-1", {
      valueRating: "A_LOT",
      paymentInterest: "NOT_NOW",
    } as never)).rejects.toThrow(
      "Choose the main reason for not paying right now",
    );
    expect(prisma.foundingValueFeedback.update).not.toHaveBeenCalled();
  });

  it("waits thirty days after a second sale-based deferral", async () => {
    const { prisma, service } = fixture();
    prisma.foundingValueFeedback.findFirst.mockResolvedValue({
      id: "feedback-2",
      businessId: "business-1",
      deferralCount: 1,
      status: "PENDING",
    });
    prisma.foundingValueFeedback.update.mockImplementation(({ data }) =>
      Promise.resolve({ id: "feedback-2", ...data }),
    );

    const before = Date.now();
    const deferred = await service.defer("business-1", "feedback-2");
    expect(deferred).toMatchObject({ status: "DEFERRED", deferralCount: 2 });
    expect((deferred.rearmAt as Date).getTime()).toBeGreaterThanOrEqual(
      before + 30 * 86_400_000,
    );
  });
});
