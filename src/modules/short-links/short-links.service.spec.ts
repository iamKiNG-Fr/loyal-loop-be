import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ShortLinksService } from "./short-links.service";

describe("ShortLinksService", () => {
  it("reuses an existing destination/source/campaign mapping", async () => {
    const prisma = fixturePrisma();
    prisma.shortLink.findUnique.mockResolvedValueOnce({ code: "AbCd2345", expiresAt: null, revokedAt: null });
    const service = new ShortLinksService(prisma as never);
    await expect(service.create({ campaign: "shop_share", kind: "SHOP", shopSlug: "demo", source: "copy" })).resolves.toEqual({ code: "AbCd2345" });
    expect(prisma.shortLink.create).not.toHaveBeenCalled();
  });

  it("creates an eight-character mapping for a validated public shop", async () => {
    const prisma = fixturePrisma();
    prisma.shortLink.findUnique.mockResolvedValue(null);
    prisma.shortLink.create.mockImplementation(async ({ data }: { data: { code: string } }) => ({ code: data.code }));
    const service = new ShortLinksService(prisma as never);
    const result = await service.create({ campaign: "shop_share", kind: "SHOP", shopSlug: "demo", source: "whatsapp" });
    expect(result.code).toMatch(/^[A-Za-z2-9]{8}$/);
    expect(prisma.shortLink.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ businessId: "business-1", source: "whatsapp" }) }));
  });

  it("resolves only active internal destinations with stored attribution", async () => {
    const prisma = fixturePrisma();
    prisma.shortLink.findUnique.mockResolvedValue({
      business: { publicCardId: "LL-DEMO22", slug: "demo" },
      campaign: "product_share",
      code: "AbCd2345",
      expiresAt: null,
      kind: "PRODUCT",
      product: { id: "product-1" },
      receiptId: null,
      revokedAt: null,
      source: "pinterest",
    });
    const service = new ShortLinksService(prisma as never);
    await expect(service.resolve("AbCd2345")).resolves.toEqual({
      attribution: { campaign: "product_share", medium: "social", source: "pinterest" },
      path: "/shop/demo?product=product-1",
    });
    await expect(service.resolve("not-valid")).rejects.toBeInstanceOf(NotFoundException);
  });
});

function fixturePrisma() {
  return {
    business: { findFirst: vi.fn().mockResolvedValue({ id: "business-1" }) },
    product: { findFirst: vi.fn() },
    receipt: { findUnique: vi.fn() },
    receiptShareToken: { findUnique: vi.fn() },
    shortLink: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  };
}
