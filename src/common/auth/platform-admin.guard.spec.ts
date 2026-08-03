import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformRolesGuard } from "./platform-roles.guard";

function context(request: Record<string, unknown>) {
  return {
    getClass: vi.fn(),
    getHandler: vi.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe("Platform admin authorization", () => {
  it("does not treat a normal owner session as platform access", async () => {
    const guard = new PlatformAdminGuard({} as never, {
      get: vi.fn(() => "true"),
    } as never);
    await expect(guard.canActivate(context({
      headers: { cookie: "ll_owner_session=owner-token" },
    }) as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a platform session after 30 minutes of inactivity", async () => {
    const prisma = {
      platformAdminSession: { findUnique: vi.fn().mockResolvedValue({
        id: "platform-session",
        platformAdminId: "admin-1",
        ownerSessionId: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        lastUsedAt: new Date(Date.now() - 31 * 60_000),
        platformAdmin: {
          id: "admin-1",
          userId: "user-1",
          role: "SUPERADMIN",
          status: "ACTIVE",
          user: { id: "user-1" },
        },
      }) },
    };
    const guard = new PlatformAdminGuard(prisma as never, {
      get: vi.fn(() => "true"),
    } as never);
    await expect(guard.canActivate(context({
      headers: {
        cookie: "ll_platform_admin_session=admin-token",
      },
    }) as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("accepts a valid standalone platform session without an owner cookie", async () => {
    const prisma = {
      platformAdminSession: {
        findUnique: vi.fn().mockResolvedValue({
          id: "platform-session",
          platformAdminId: "admin-1",
          ownerSessionId: null,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          lastUsedAt: new Date(),
          verifiedAt: new Date(),
          platformAdmin: {
            id: "admin-1",
            userId: "user-1",
            role: "SUPERADMIN",
            status: "ACTIVE",
            user: { id: "user-1" },
          },
        }),
        update: vi.fn(),
      },
    };
    const guard = new PlatformAdminGuard(prisma as never, {
      get: vi.fn((key: string) => key === "ADMIN_PORTAL_ENABLED" ? "true" : "test-secret"),
    } as never);
    const request = {
      headers: { cookie: "ll_platform_admin_session=admin-token" },
      header: vi.fn(),
      ip: "127.0.0.1",
    };
    await expect(guard.canActivate(context(request) as never)).resolves.toBe(true);
    expect(request).toHaveProperty("platformAuth.ownerSessionId", undefined);
  });

  it.each([
    ["SUPERADMIN", true],
    ["ADMIN", true],
    ["FINANCE_ADMIN", false],
  ] as const)("applies explicit endpoint roles to %s", (role, allowed) => {
    const reflector = new Reflector();
    vi.spyOn(reflector, "getAllAndOverride").mockReturnValue(["SUPERADMIN", "ADMIN"]);
    const guard = new PlatformRolesGuard(reflector);
    const action = () => guard.canActivate(context({ platformAuth: { role } }) as never);
    if (allowed) expect(action()).toBe(true);
    else expect(action).toThrow(ForbiddenException);
  });
});
