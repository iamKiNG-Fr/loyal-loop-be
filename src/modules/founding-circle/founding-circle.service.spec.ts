import { describe, expect, it, vi } from "vitest";
import {
  createInvitationCode,
  FoundingCircleService,
  normalizeInvitationCode,
} from "./founding-circle.service";

function fixture() {
  const prisma = {
    foundingAccessApplication: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    onboardingInvitation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  const config = {
    get: vi.fn((key: string, fallback?: string) => ({
      FOUNDING_ACCESS_REQUIRED: "true",
      FOUNDING_GRANT_SECRET: "grant-secret-with-enough-entropy",
      FOUNDING_INVITATION_HASH_SECRET: "hash-secret-with-enough-entropy",
    })[key] ?? fallback),
  };
  const messaging = {
    grantFoundingAccessConsent: vi.fn(),
  };
  return {
    prisma,
    messaging,
    service: new FoundingCircleService(
      prisma as never,
      config as never,
      messaging as never,
    ),
  };
}

describe("Founding Circle invitations", () => {
  it("creates human-readable codes without ambiguous characters", () => {
    const code = createInvitationCode();
    expect(code).toMatch(/^LL-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeInvitationCode(` ${code.toLowerCase()} `)).toBe(
      code.replaceAll("-", ""),
    );
  });

  it("validates without consuming and restores the signed onboarding grant", async () => {
    const { prisma, service } = fixture();
    prisma.onboardingInvitation.findUnique.mockResolvedValue({
      id: "invite-1",
      codeSuffix: "AB12",
      status: "ISSUED",
      useCount: 0,
      maxUses: 1,
      expiresAt: new Date(Date.now() + 2 * 86_400_000),
    });
    const validated = await service.validateAccess("LL-ABCD-EFGH-JK12");
    expect(prisma.onboardingInvitation.update).toHaveBeenCalledWith({
      where: { id: "invite-1" },
      data: { validatedAt: expect.any(Date) },
    });
    expect(validated.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 24 * 60 * 60 * 1000,
    );
    const restored = await service.grantStatus(validated.grantToken);
    expect(restored).toMatchObject({
      required: true,
      valid: true,
      invitationSuffix: "AB12",
    });
  });

  it("deduplicates applications while preserving the explicit consent grant", async () => {
    const { messaging, prisma, service } = fixture();
    prisma.foundingAccessApplication.findFirst.mockResolvedValue({ id: "existing" });
    await expect(service.createApplication({
      ownerName: "Aisha Bello",
      businessName: "Soft Scents",
      email: "aisha@example.com",
      phone: "+2348012345678",
      whatTheySell: "Fragrance oils",
      primarySellingChannel: "WHATSAPP",
      whatsappConsent: true,
    })).resolves.toEqual({ applicationId: "existing", received: true });
    expect(prisma.foundingAccessApplication.create).not.toHaveBeenCalled();
    expect(messaging.grantFoundingAccessConsent).toHaveBeenCalledWith(
      "+2348012345678",
      "homepage-request",
    );
  });

  it("binds redemption to the verified WhatsApp number", async () => {
    const { service } = fixture();
    const tx = {
      onboardingInvitation: {
        findUnique: vi.fn().mockResolvedValue({
          id: "invite-1",
          phone: "+2348012345678",
          status: "ISSUED",
          useCount: 0,
          maxUses: 1,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        updateMany: vi.fn(),
      },
    };
    await expect(service.redeemInTransaction(tx as never, {
      invitationId: "invite-1",
      expiresAt: Date.now() + 60_000,
    }, {
      businessId: "business-1",
      email: "aisha@example.com",
      phone: "+2348099999999",
      userId: "user-1",
    })).rejects.toThrow("Verify the WhatsApp number that received this invitation");
    expect(tx.onboardingInvitation.updateMany).not.toHaveBeenCalled();
  });
});
