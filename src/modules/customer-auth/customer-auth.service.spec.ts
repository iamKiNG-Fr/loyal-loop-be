import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../prisma/prisma.service";
import { CustomerAuthService } from "./customer-auth.service";
import type { OtpProvider } from "./otp-provider";

describe("CustomerAuthService dual-role identity", () => {
  it("creates a customer session when the verified phone also belongs to a vendor", async () => {
    const phone = "+2348012345678";
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const ownerLookup = vi.fn();
    const prisma = {
      user: { findUnique: ownerLookup },
      customerOtpChallenge: {
        findUnique: vi.fn().mockResolvedValue({
          id: "challenge-1",
          phone,
          providerReference: "sandbox:salt:digest",
          expiresAt,
          verifiedAt: null,
          attempts: 0,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      customerAccount: {
        upsert: vi.fn().mockResolvedValue({
          id: "customer-1",
          phone,
          name: null,
          verifiedAt: new Date(),
        }),
      },
      customerAccountSession: {
        create: vi.fn().mockResolvedValue({ id: "customer-session-1" }),
      },
    };
    const provider = {
      start: vi.fn(),
      verify: vi.fn().mockResolvedValue(true),
    } satisfies OtpProvider;
    const config = {
      get: vi.fn((_key: string, fallback: number) => fallback),
    } as unknown as ConfigService;
    const service = new CustomerAuthService(
      prisma as unknown as PrismaService,
      config,
      provider,
    );

    const result = await service.verify("challenge-1", "123456");

    expect(ownerLookup).not.toHaveBeenCalled();
    expect(prisma.customerAccount.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phone } }),
    );
    expect(prisma.customerAccountSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ customerAccountId: "customer-1" }),
    });
    expect(result.account.phone).toBe(phone);
    expect(result.session.id).toBe("customer-session-1");
  });
});
