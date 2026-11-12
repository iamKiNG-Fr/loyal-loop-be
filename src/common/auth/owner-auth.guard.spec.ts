import { describe, expect, it, vi } from "vitest";
import { hashToken } from "../crypto.util";
import { OwnerAuthGuard } from "./owner-auth.guard";

type Options = {
  businessHeader?: string;
  businesses?: Array<{ id: string; platformStatus: string }>;
  memberships?: Array<{ id: string; businessId: string; role: string; status: string }>;
  overrides?: Array<{ memberId: string; capability: string; allowed: boolean }>;
  path?: string;
  session?: Record<string, unknown> | null;
};

function harness(options: Options = {}) {
  const session = options.session === undefined
    ? { id: "session-1", userId: "user-1", revokedAt: null, expiresAt: new Date(Date.now() + 60_000), lastUsedAt: new Date() }
    : options.session;
  const prisma = {
    ownerSession: { findUnique: vi.fn().mockResolvedValue(session), update: vi.fn().mockResolvedValue(null) },
    businessMember: { findMany: vi.fn().mockResolvedValue(options.memberships ?? [
      { id: "member-a", businessId: "business-a", role: "OWNER", status: "ACTIVE" },
      { id: "member-b", businessId: "business-b", role: "MANAGER", status: "ACTIVE" },
    ]) },
    memberPermissionOverride: { findMany: vi.fn().mockResolvedValue(options.overrides ?? []) },
    business: { findMany: vi.fn().mockResolvedValue(options.businesses ?? [
      { id: "business-a", platformStatus: "ACTIVE" },
      { id: "business-b", platformStatus: "ACTIVE" },
    ]) },
  };
  const request: Record<string, unknown> = {
    headers: { cookie: "ll_owner_session=raw-token" },
    header: vi.fn((name: string) => (name === "x-business-id" ? options.businessHeader : undefined)),
    path: options.path ?? "/api/v1/sales",
  };
  const context = { switchToHttp: () => ({ getRequest: () => request }) };
  const run = () => new OwnerAuthGuard(prisma as never).canActivate(context as never);
  return { prisma, request, run };
}

describe("OwnerAuthGuard", () => {
  it("derives business scope from an active membership, not request data", async () => {
    const { prisma, request, run } = harness({ businessHeader: "business-b" });
    await expect(run()).resolves.toBe(true);
    expect(prisma.ownerSession.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashToken("raw-token") } });
    expect(request).toHaveProperty("auth.businessId", "business-b");
    expect(request).toHaveProperty("auth.memberId", "member-b");
    expect(request).toHaveProperty("auth.role", "MANAGER");
    expect(request).toHaveProperty("auth.userId", "user-1");
  });

  it("reads memberships, overrides and businesses for the session's own user only, and only active ones", async () => {
    const { prisma, run } = harness();
    await run();
    const scope = { userId: "user-1", status: "ACTIVE" };
    expect(prisma.businessMember.findMany).toHaveBeenCalledWith({ where: scope, orderBy: { createdAt: "asc" } });
    expect(prisma.memberPermissionOverride.findMany.mock.calls[0][0].where).toEqual({ member: scope });
    expect(prisma.business.findMany.mock.calls[0][0].where).toEqual({ members: { some: scope } });
  });

  it("uses the first active membership when no business is requested", async () => {
    const { request, run } = harness();
    await run();
    expect(request).toHaveProperty("auth.businessId", "business-a");
  });

  it("refuses a business the user does not belong to", async () => {
    const { request, run } = harness({ businessHeader: "business-z" });
    await expect(run()).rejects.toThrow("No active business membership");
    expect(request).not.toHaveProperty("auth");
  });

  it.each([
    ["missing", null],
    ["revoked", { id: "s", userId: "user-1", revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000), lastUsedAt: new Date() }],
    ["expired", { id: "s", userId: "user-1", revokedAt: null, expiresAt: new Date(Date.now() - 1), lastUsedAt: new Date() }],
  ])("refuses a %s session before reading anything else", async (_label, session) => {
    const { prisma, request, run } = harness({ session });
    await expect(run()).rejects.toThrow("Session expired");
    expect(prisma.businessMember.findMany).not.toHaveBeenCalled();
    expect(prisma.memberPermissionOverride.findMany).not.toHaveBeenCalled();
    expect(prisma.business.findMany).not.toHaveBeenCalled();
    expect(request).not.toHaveProperty("auth");
  });

  it("applies only the chosen membership's permission overrides", async () => {
    const overrides = [
      { memberId: "member-a", capability: "PAYMENT_REVIEW", allowed: false },
      { memberId: "member-b", capability: "PAYMENT_REVIEW", allowed: true },
    ];
    const memberships = [
      { id: "member-a", businessId: "business-a", role: "VIEWER", status: "ACTIVE" },
      { id: "member-b", businessId: "business-b", role: "VIEWER", status: "ACTIVE" },
    ];
    const granted = harness({ businessHeader: "business-b", memberships, overrides });
    await granted.run();
    expect((granted.request as any).auth.capabilities).toContain("PAYMENT_REVIEW");
    const denied = harness({ businessHeader: "business-a", memberships, overrides });
    await denied.run();
    expect((denied.request as any).auth.capabilities).not.toContain("PAYMENT_REVIEW");
  });

  it("blocks a suspended business except for the session and sign-out routes", async () => {
    const businesses = [{ id: "business-a", platformStatus: "SUSPENDED" }, { id: "business-b", platformStatus: "ACTIVE" }];
    await expect(harness({ businesses }).run()).rejects.toMatchObject({ response: { error: "BUSINESS_SUSPENDED" } });
    await expect(harness({ businesses, path: "/api/v1/auth/me" }).run()).resolves.toBe(true);
    await expect(harness({ businesses, path: "/api/v1/auth/logout" }).run()).resolves.toBe(true);
    // Another business the same user belongs to is unaffected.
    await expect(harness({ businesses, businessHeader: "business-b" }).run()).resolves.toBe(true);
  });
});
