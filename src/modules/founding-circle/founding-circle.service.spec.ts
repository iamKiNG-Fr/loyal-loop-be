import { describe, expect, it, vi } from "vitest";
import {
  createInvitationCode,
  FoundingCircleService,
  normalizeInvitationCode,
} from "./founding-circle.service";

function fixture(overrides: Record<string, string | undefined> = {}) {
  const prisma = {
    foundingAccessApplication: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    onboardingInvitation: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const settings: Record<string, string | undefined> = {
      FOUNDING_ACCESS_REQUIRED: "true",
      FOUNDING_GRANT_SECRET: "grant-secret-with-enough-entropy",
      FOUNDING_INVITATION_HASH_SECRET: "hash-secret-with-enough-entropy",
      ...overrides,
  };
  const config = {
    get: vi.fn((key: string, fallback?: string) => settings[key] ?? fallback),
  };
  const messaging = {
    grantFoundingAccessConsent: vi.fn(),
  };
  return {
    prisma,
    settings,
    messaging,
    service: new FoundingCircleService(
      prisma as never,
      config as never,
      messaging as never,
    ),
  };
}

describe("Founding Circle invitations", () => {
  it("requires invitations by default in development and production", async () => {
    for (const NODE_ENV of ["development", "production", "test"]) {
      const { service } = fixture({ NODE_ENV, FOUNDING_ACCESS_REQUIRED: undefined });
      expect(service.accessRequired()).toBe(true);
      expect(await service.grantStatus()).toMatchObject({ required: true, valid: false });
      expect(() => service.resolveRegistrationGrant()).toThrow("A valid Founding Circle invitation");
    }
  });

  it("only disables access for an explicit false setting", () => {
    for (const value of ["", "TRUE", "invalid", "true"]) {
      expect(fixture({ FOUNDING_ACCESS_REQUIRED: value }).service.accessRequired()).toBe(true);
    }
    expect(fixture({ FOUNDING_ACCESS_REQUIRED: "false" }).service.accessRequired()).toBe(false);
  });

  it("rejects an earlier open-mode grant after invitation gating is enabled", async () => {
    const { service, settings } = fixture({ FOUNDING_ACCESS_REQUIRED: "false" });
    const openGrant = await service.validateAccess("unused-in-open-mode");
    expect(service.resolveRegistrationGrant(openGrant.grantToken)).toBeNull();
    settings.FOUNDING_ACCESS_REQUIRED = "true";
    expect(() => service.resolveRegistrationGrant(openGrant.grantToken)).toThrow("A valid Founding Circle invitation");
    expect(await service.grantStatus(openGrant.grantToken)).toMatchObject({ required: true, valid: false });
  });

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

async function draftFixture() {
  const setup = fixture();
  const invitation = {
    id: "invite-1", codeSuffix: "TEST", status: "ISSUED", useCount: 0, maxUses: 1,
    expiresAt: new Date(Date.now() + 10 * 86_400_000), draftRevision: 0,
    draftCiphertext: null as string | null, draftSavedAt: null as Date | null,
    draftExpiresAt: null as Date | null, onboardingStep: null as number | null,
    onboardingStartedAt: null as Date | null,
  };
  setup.prisma.onboardingInvitation.findUnique.mockImplementation(async () => ({ ...invitation }));
  setup.prisma.onboardingInvitation.updateMany.mockImplementation(async ({ where, data }) => {
    if ((where.draftRevision !== undefined && where.draftRevision !== invitation.draftRevision) || (where.status && where.status !== invitation.status)) return { count: 0 };
    Object.assign(invitation, { ...data, draftRevision: invitation.draftRevision + 1 });
    return { count: 1 };
  });
  const access = await setup.service.validateAccess("LL-ABCD-EFGH-JK12");
  return { ...setup, invitation, grant: access.grantToken };
}

describe("online onboarding drafts", () => {
  it("resumes safe fields with a fresh grant and never persists verification or passwords", async () => {
    const { service, invitation, grant } = await draftFixture();
    const saved = await service.saveOnboardingDraft(grant, { revision: 0, currentStep: 1, form: {
      ownerName: "Fixture Owner", businessName: "Fixture Shop", email: "fixture@example.com",
      password: "secret-password", emailVerificationChallengeId: "secret-proof", rawCode: "secret-code",
      channels: ["whatsapp", "evil"], socialAccounts: { instagram: "@fixture", password: "secret-social" },
    } });
    expect(saved.revision).toBe(1);
    expect(invitation.draftCiphertext).not.toContain("Fixture");
    expect(invitation.draftExpiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86_400_000);
    const fresh = await service.validateAccess("LL-ABCD-EFGH-JK12");
    const restored = await service.readOnboardingDraft(fresh.grantToken);
    expect(restored.draft).toMatchObject({ currentStep: 1, form: { businessName: "Fixture Shop", channels: ["whatsapp"] } });
    expect(JSON.stringify(restored)).not.toMatch(/secret-|password|VerificationChallengeId/);
    expect(service.safeInvitation(invitation)).not.toHaveProperty("draftCiphertext");
    expect(service.safeInvitation(invitation)).toHaveProperty("onboardingStep", 1);
  });

  it("rejects a stale device and preserves the furthest reached step", async () => {
    const { service, invitation, grant, prisma } = await draftFixture();
    await service.saveOnboardingDraft(grant, { revision: 0, currentStep: 2, form: { businessName: "First" } });
    await expect(service.saveOnboardingDraft(grant, { revision: 0, currentStep: 0, form: { businessName: "Stale" } })).rejects.toThrow("saved draft changed");
    expect(prisma.onboardingInvitation.updateMany).toHaveBeenCalledTimes(1);
    await service.saveOnboardingDraft(grant, { revision: 1, currentStep: 0, form: { businessName: "Latest" } });
    expect(invitation.onboardingStep).toBe(2);
    expect((await service.readOnboardingDraft(grant)).draft?.form.businessName).toBe("Latest");
  });

  it("rejects missing, forged, revoked, consumed and expired invitation access", async () => {
    const { service, invitation, grant } = await draftFixture();
    await expect(service.readOnboardingDraft()).rejects.toThrow("Open your invitation");
    await expect(service.readOnboardingDraft(`${grant}forged`)).rejects.toThrow();
    for (const status of ["REVOKED", "REDEEMED"]) {
      invitation.status = status;
      await expect(service.saveOnboardingDraft(grant, { revision: 0, currentStep: 0, form: {} })).rejects.toThrow("no longer available");
    }
    invitation.status = "ISSUED"; invitation.useCount = 1;
    await expect(service.readOnboardingDraft(grant)).rejects.toThrow("no longer available");
    invitation.useCount = 0; invitation.expiresAt = new Date(0);
    await expect(service.readOnboardingDraft(grant)).rejects.toThrow("no longer available");
  });

  it("expires editable details while keeping factual progress metadata", async () => {
    const { service, invitation, grant } = await draftFixture();
    await service.saveOnboardingDraft(grant, { revision: 0, currentStep: 1, form: { businessName: "Expired" } });
    invitation.draftExpiresAt = new Date(0);
    expect(await service.readOnboardingDraft(grant)).toEqual({ draft: null, revision: 2 });
    expect(invitation.draftCiphertext).toBeNull();
    expect(invitation.onboardingStep).toBe(1);
    expect(invitation.draftSavedAt).toBeInstanceOf(Date);
  });

  it("binds authenticated ciphertext to its invitation", async () => {
    const { service, invitation, grant } = await draftFixture();
    await service.saveOnboardingDraft(grant, { revision: 0, currentStep: 0, form: { ownerName: "Private" } });
    invitation.id = "different-invitation";
    const other = await service.validateAccess("LL-ABCD-EFGH-JK12");
    await expect(service.readOnboardingDraft(other.grantToken)).rejects.toThrow();
  });

  it("clears the draft atomically on completion and rejects late autosaves", async () => {
    const { service, invitation, grant, prisma } = await draftFixture();
    Object.assign(invitation, { phone: "+2348012345678" });
    await service.saveOnboardingDraft(grant, { revision: 0, currentStep: 1, form: { ownerName: "Private" } });
    const tx = { ...prisma, foundingProgramEnrollment: { create: vi.fn() } };
    await service.redeemInTransaction(tx as never, service.resolveRegistrationGrant(grant), { userId: "user", businessId: "shop", email: "fixture@example.com", phone: "+2348012345678" });
    expect(invitation.draftCiphertext).toBeNull();
    expect(invitation.status).toBe("REDEEMED");
    await expect(service.saveOnboardingDraft(grant, { revision: 1, currentStep: 2, form: {} })).rejects.toThrow("no longer available");
  });
});
