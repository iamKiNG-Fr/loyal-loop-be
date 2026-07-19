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
      updateMany: vi.fn(),
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
  const founding = {
    resolveRegistrationGrant: vi.fn().mockReturnValue(null),
    redeemInTransaction: vi.fn(),
  };
  return {
    config,
    founding,
    otpProvider,
    prisma,
    service: new AuthService(
      prisma as never,
      config as never,
      mail as never,
      founding as never,
      otpProvider,
    ),
  };
}

describe("AuthService WhatsApp owner sign-in", () => {
  it("starts a development onboarding challenge without requiring an owner account", async () => {
    const { otpProvider, prisma, service } = createService();
    otpProvider.start.mockResolvedValue({
      provider: "internal-sandbox",
      reference: "sandbox:salt:hashed-code",
      expiresAt: new Date("2026-07-02T12:30:00.000Z"),
    });
    prisma.ownerOtpChallenge.create.mockResolvedValue({
      id: "onboarding-otp-1",
      expiresAt: new Date("2026-07-02T12:30:00.000Z"),
    });

    const result = await service.startOnboardingWhatsapp("+2348012345678");

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(otpProvider.start).toHaveBeenCalledWith("+2348012345678");
    expect(prisma.ownerOtpChallenge.updateMany).toHaveBeenCalledWith({
      where: {
        phone: "+2348012345678",
        userId: null,
        verifiedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { expiresAt: expect.any(Date) },
    });
    expect(result.challengeId).toBe("onboarding-otp-1");
  });

  it("verifies a pre-account onboarding phone without creating a session", async () => {
    const { otpProvider, prisma, service } = createService();
    prisma.ownerOtpChallenge.findUnique.mockResolvedValue({
      id: "onboarding-otp-1",
      userId: null,
      phone: "+2348012345678",
      providerReference: "sandbox:salt:hashed-code",
      attempts: 0,
      verifiedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    otpProvider.verify.mockResolvedValue(true);

    const result = await service.verifyOnboardingWhatsapp(
      "onboarding-otp-1",
      "123456",
    );

    expect(result.challengeId).toBe("onboarding-otp-1");
    expect(prisma.ownerOtpChallenge.update).toHaveBeenLastCalledWith({
      where: { id: "onboarding-otp-1" },
      data: {
        verifiedAt: expect.any(Date),
        expiresAt: expect.any(Date),
      },
    });
    expect(prisma.ownerSession.create).not.toHaveBeenCalled();
  });

  it("starts verification only for an eligible owner phone", async () => {
    const { otpProvider, prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    otpProvider.start.mockResolvedValue({
      provider: "internal-sandbox",
      reference: "sandbox:salt:hashed-code",
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
    });
    expect(result).not.toHaveProperty("developmentCode");
  });

  it("creates an owner session after a valid WhatsApp code", async () => {
    const { otpProvider, prisma, service } = createService();
    prisma.ownerOtpChallenge.findUnique.mockResolvedValue({
      id: "otp-1",
      userId: "user-1",
      phone: "+2348012345678",
      providerReference: "sandbox:salt:hashed-code",
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
      "sandbox:salt:hashed-code",
      "+2348012345678",
      "123456",
    );
    expect(result.user.name).toBe("Francis King");
    expect(result.business).toMatchObject({ id: "business-1" });
    expect(result.session.id).toBe("session-1");
  });

  it("rejects registration when the verified phone proof cannot be claimed", async () => {
    const { prisma, service } = createService();
    const businessCreate = vi.fn();
    prisma.$transaction = vi.fn(async (work) => work({
      business: { create: businessCreate },
      ownerOtpChallenge: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      user: { create: vi.fn().mockResolvedValue({ id: "user-1" }) },
    }));

    await expect(service.register({
      businessName: "Fixture Shop",
      category: "Retail",
      contacts: [{ platform: "WHATSAPP", value: "+2348012345678", isPrimary: true }],
      email: "owner@example.test",
      location: "Lagos",
      ownerName: "Fixture Owner",
      password: "secure-password",
      phoneVerificationChallengeId: "unclaimed-proof",
      slug: "fixture-shop",
    }, {})).rejects.toThrow("Verify this WhatsApp number again");

    expect(businessCreate).not.toHaveBeenCalled();
  });
});
