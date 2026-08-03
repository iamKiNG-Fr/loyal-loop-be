import { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { PlatformAuthService } from "./platform-auth.service";

function fixture() {
  const admin = {
    id: "admin-1",
    userId: "user-1",
    role: "SUPERADMIN",
    status: "ACTIVE",
  };
  const user = {
    id: "user-1",
    name: "Admin User",
    email: "admin@example.com",
    phone: "+2348012345678",
    passwordHash: "unused",
    workspaceAppearance: "LIGHT",
    avatarAssetId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    platformAdmin: admin,
  };
  const tx = {
    ownerOtpChallenge: {
      create: vi.fn().mockResolvedValue({ id: "challenge-1", expiresAt: new Date(Date.now() + 60_000) }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    platformAdminSession: {
      create: vi.fn().mockResolvedValue({ id: "platform-session" }),
    },
    platformAdminAuditLog: { create: vi.fn() },
  };
  const prisma = {
    user: { findFirst: vi.fn().mockResolvedValue(user) },
    ownerOtpChallenge: {
      findFirst: vi.fn().mockResolvedValue({
        id: "challenge-1",
        userId: user.id,
        phone: user.phone,
        providerReference: "otp-reference",
        verifiedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        attempts: 0,
        user,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    platformAdminPasskey: { count: vi.fn().mockResolvedValue(0) },
    $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
  };
  const config = new ConfigService({
    ADMIN_PORTAL_ENABLED: "true",
    ADMIN_WHATSAPP_FALLBACK_ENABLED: "true",
    ADMIN_PASSKEY_REQUIRED: "false",
    ADMIN_PASSKEY_ENABLED: "false",
    SESSION_HASH_SECRET: "test-session-secret",
  });
  const otp = {
    start: vi.fn().mockResolvedValue({
      provider: "test",
      reference: "otp-reference",
      expiresAt: new Date(Date.now() + 60_000),
    }),
    verify: vi.fn().mockResolvedValue(true),
  };
  return { admin, config, otp, prisma, service: new PlatformAuthService(prisma as never, config, otp as never), tx, user };
}

describe("PlatformAuthService standalone administrator access", () => {
  it("resolves an administrator email and sends the OTP to its attached WhatsApp number", async () => {
    const { otp, prisma, service, user } = fixture();
    await expect(service.start("ADMIN@EXAMPLE.COM")).resolves.toMatchObject({ challengeId: "challenge-1" });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "admin@example.com" } }));
    expect(otp.start).toHaveBeenCalledWith(user.phone);
  });

  it("accepts a Nigerian local phone identifier", async () => {
    const { otp, prisma, service } = fixture();
    await service.start("08012345678");
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: "+2348012345678" } }));
    expect(otp.start).toHaveBeenCalledWith("+2348012345678");
  });

  it("creates a platform-only session after a valid OTP", async () => {
    const { service, tx } = fixture();
    await expect(service.verify("challenge-1", "123456")).resolves.toMatchObject({
      admin: { stepUpRequired: false },
    });
    expect(tx.platformAdminSession.create).toHaveBeenCalledWith({
      data: expect.not.objectContaining({ ownerSessionId: expect.anything() }),
    });
  });
});
