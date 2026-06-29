import { describe, expect, it, vi } from "vitest";
import { hashToken } from "../crypto.util";
import { OwnerAuthGuard } from "./owner-auth.guard";

describe("OwnerAuthGuard", () => {
  it("derives business scope from an active membership, not request data", async () => {
    const prisma = {
      ownerSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: "session-1",
          userId: "user-1",
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          lastUsedAt: new Date(),
          user: {
            memberships: [
              {
                businessId: "business-a",
                role: "OWNER",
                status: "ACTIVE",
              },
              {
                businessId: "business-b",
                role: "MANAGER",
                status: "ACTIVE",
              },
            ],
          },
        }),
        update: vi.fn(),
      },
    };
    const request = {
      headers: { cookie: "ll_owner_session=raw-token" },
      header: vi.fn((name: string) =>
        name === "x-business-id" ? "business-b" : undefined,
      ),
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    };

    await expect(
      new OwnerAuthGuard(prisma as never).canActivate(context as never),
    ).resolves.toBe(true);
    expect(prisma.ownerSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken("raw-token") } }),
    );
    expect(request).toHaveProperty("auth.businessId", "business-b");
    expect(request).toHaveProperty("auth.role", "MANAGER");
  });
});
