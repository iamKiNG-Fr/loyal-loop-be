import { describe, expect, it, vi } from "vitest";
import { AuthService } from "./auth.service";

function createService() {
  const prisma = {
    $transaction: vi.fn(),
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    business: {
      findFirst: vi.fn(),
    },
    ownerOtpChallenge: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    ownerSession: {
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    passwordRecoveryToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const config = {
    get: vi.fn((_key: string, fallback: unknown) => fallback),
  };
  const mail = {
    sendPasswordResetEmail: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (work: unknown) =>
    Array.isArray(work)
      ? Promise.all(work)
      : (work as (tx: typeof prisma) => Promise<unknown>)(prisma),
  );
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
    mail,
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

describe("AuthService password recovery", () => {
  it("retires older links before sending a one-time reset link", async () => {
    const { mail, prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "owner@example.com", name: "Ada" });
    prisma.passwordRecoveryToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.passwordRecoveryToken.create.mockResolvedValue({ id: "reset-1" });
    mail.sendPasswordResetEmail.mockResolvedValue(undefined);

    await service.requestPasswordReset(" OWNER@example.com ");

    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: "owner@example.com" } });
    expect(prisma.passwordRecoveryToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: "user-1", usedAt: null },
    }));
    expect(mail.sendPasswordResetEmail).toHaveBeenCalledWith(expect.objectContaining({
      name: "Ada",
      to: "owner@example.com",
      token: expect.any(String),
    }));
  });

  it("invalidates a generated link when email delivery fails without exposing the account", async () => {
    const { mail, prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: "user-1", email: "owner@example.com", name: "Ada" });
    prisma.passwordRecoveryToken.updateMany.mockResolvedValue({ count: 0 });
    prisma.passwordRecoveryToken.create.mockResolvedValue({ id: "reset-1" });
    mail.sendPasswordResetEmail.mockRejectedValue(new Error("provider unavailable"));

    await expect(service.requestPasswordReset("owner@example.com")).resolves.toBeUndefined();
    expect(prisma.passwordRecoveryToken.update).toHaveBeenCalledWith({
      where: { id: "reset-1" },
      data: { usedAt: expect.any(Date) },
    });
  });
});

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

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { phone: "+2348012345678" },
      select: { id: true },
    });
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

  it("does not send an onboarding code to a phone that already owns a workspace", async () => {
    const { otpProvider, prisma, service } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: "user-1" });

    await expect(service.startOnboardingWhatsapp("+2348012345678"))
      .rejects.toThrow("already belongs to a Loyal Loop business");
    expect(otpProvider.start).not.toHaveBeenCalled();
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
    expect(prisma.ownerOtpChallenge.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "onboarding-otp-1",
        userId: null,
        verifiedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
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
    expect(prisma.ownerOtpChallenge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ purpose: "LOGIN", userId: "user-1" }),
    }));
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
