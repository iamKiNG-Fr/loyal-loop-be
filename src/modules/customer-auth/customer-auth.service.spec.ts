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
      $transaction: vi.fn(),
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
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
    prisma.$transaction.mockImplementation(async (work: unknown) =>
      Array.isArray(work)
        ? Promise.all(work)
        : (work as (tx: typeof prisma) => Promise<unknown>)(prisma),
    );
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

  it("returns only open balances matched to the verified account and selected shop", async () => {
    const saleFindMany = vi.fn().mockResolvedValue([
      {
        amountPaid: 20000,
        currency: "NGN",
        customer: { name: "King" },
        items: [{ imageUrl: null, name: "Ankara set", quantity: 1 }],
        referenceCode: "LL-OPEN-1",
        soldAt: new Date("2026-08-20T12:00:00.000Z"),
        total: 50000,
      },
      {
        amountPaid: 30000,
        currency: "NGN",
        customer: { name: "King" },
        items: [{ imageUrl: null, name: "Paid item", quantity: 1 }],
        referenceCode: "LL-CLEAR-1",
        soldAt: new Date("2026-08-19T12:00:00.000Z"),
        total: 30000,
      },
    ]);
    const prisma = {
      business: {
        findUnique: vi.fn().mockResolvedValue({
          id: "business-1",
          logoAsset: null,
          name: "King's Store",
          slug: "kings-store",
        }),
      },
      customerAccount: {
        findUnique: vi.fn().mockResolvedValue({
          name: null,
          phone: "+2348012345678",
        }),
      },
      sale: { findMany: saleFindMany },
    };
    const service = new CustomerAuthService(
      prisma as unknown as PrismaService,
      { get: vi.fn() } as unknown as ConfigService,
      { start: vi.fn(), verify: vi.fn() } as unknown as OtpProvider,
    );

    const statement = await service.listBalances("account-1", "kings-store");

    expect(saleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        businessId: "business-1",
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        status: "COMPLETED",
        customer: {
          OR: [
            { accountId: "account-1" },
            { phone: { in: ["+2348012345678", "2348012345678", "08012345678"] } },
          ],
        },
      }),
    }));
    expect(statement.balance).toBe(30000);
    expect(statement.saleCount).toBe(1);
    expect(statement.sales.map((sale) => sale.referenceCode)).toEqual(["LL-OPEN-1"]);
    expect(statement.customer.name).toBe("King");
    expect(statement).not.toHaveProperty("phone");
    expect(statement).not.toHaveProperty("customerId");
  });
});
