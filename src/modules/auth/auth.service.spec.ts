import { describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service";

function createService() {
  const prisma = {
    user: {
      findUnique: vi.fn(),
    },
    ownerOtpChallenge: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ownerSession: {
      create: vi.fn(),
    },
  };
  const config = {
    get: vi.fn((_key: string, fallback: unknown) => fallback),
  };
  const mail = {};
  const otpProvider = {
    start: vi.fn(),
    verify: vi.fn(),
  };
  return {
    config,
    otpProvider,
    prisma,
    service: new AuthService(
      prisma as never,
      config as never,
      mail as never,
      otpProvider,
    ),
  };
}

describe("AuthService WhatsApp owner sign-in", () => {
  it("starts verification only for an eligible owner phone", async () => {
    const { otpProvider, prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    otpProvider.start.mockResolvedValue({
      provider: "development",
      reference: "dev:challenge:123456",
      expiresAt: new Date("2026-07-02T12:30:00.000Z"),
    });
    prisma.ownerOtpChallenge.create.mockResolvedValue({
      id: "otp-1",
      expiresAt: new Date("2026-07-02T12:30:00.000Z"),
    });

    const result = await service.startWhatsapp("+2348012345678");

    expect(otpProvider.start).toHaveBeenCalledWith("+2348012345678");
    expect(result).toMatchObject({
      challengeId: "otp-1",
      developmentCode: "123456",
    });
  });

  it("creates an owner session after a valid WhatsApp code", async () => {
    const { otpProvider, prisma, service } = createService();
    prisma.ownerOtpChallenge.findUnique.mockResolvedValue({
      id: "otp-1",
      userId: "user-1",
      phone: "+2348012345678",
      providerReference: "dev:challenge:123456",
      attempts: 0,
      verifiedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    otpProvider.verify.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "Francis King",
      email: "demo@useloyalloop.com",
      phone: "+2348012345678",
      memberships: [{
        business: { id: "business-1", name: "King's Store Demo" },
      }],
    });
    prisma.ownerSession.create.mockResolvedValue({ id: "session-1" });

    const result = await service.verifyWhatsapp(
      "otp-1",
      "123456",
      { userAgent: "test" },
    );

    expect(otpProvider.verify).toHaveBeenCalledWith(
      "dev:challenge:123456",
      "+2348012345678",
      "123456",
    );
    expect(result.user.name).toBe("Francis King");
    expect(result.business).toMatchObject({ id: "business-1" });
    expect(result.session.id).toBe("session-1");
  });
});
