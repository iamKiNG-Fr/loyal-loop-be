import { describe, expect, it, vi } from "vitest";
import { PublicDiscoveryController } from "./discovery.controller";
import { DiscoveryService } from "./discovery.service";

function serviceFixture() {
  const prisma = {
    business: { findMany: vi.fn().mockResolvedValue([{ slug: "real-shop", updatedAt: new Date("2026-08-09") }]) },
    commerceEvent: { groupBy: vi.fn().mockResolvedValue([]) },
    product: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const service = new DiscoveryService(
    prisma as never,
    { parseDiscoveryQuery: vi.fn() } as never,
    { get: vi.fn() } as never,
  );
  return { prisma, service };
}

describe("DiscoveryService public discovery safeguards", () => {
  it("builds sitemap entries from real open shops and media-ready products", async () => {
    const { prisma, service } = serviceFixture();

    await expect(service.sitemapEntries()).resolves.toEqual({
      products: [],
      shops: [{ slug: "real-shop", updatedAt: new Date("2026-08-09") }],
    });

    expect(prisma.business.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        isDemo: false,
        platformStatus: "ACTIVE",
        storeStatus: "OPEN",
        products: { some: expect.objectContaining({ status: "ACTIVE", visibility: "PUBLIC" }) },
      }),
    }));
    expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        business: { isDemo: false, platformStatus: "ACTIVE", storeStatus: "OPEN" },
        status: "ACTIVE",
        visibility: "PUBLIC",
      }),
    }));
  });

  it("coalesces and briefly caches non-personal discovery aggregates", async () => {
    const { prisma, service } = serviceFixture();
    const load = () => (service as unknown as { globalDiscoveryData: () => Promise<unknown> }).globalDiscoveryData();

    await Promise.all([load(), load()]);
    await load();

    expect(prisma.product.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.commerceEvent.groupBy).toHaveBeenCalledTimes(2);
  });
});

describe("PublicDiscoveryController caching", () => {
  it("marks visitor-bound responses private and exposes timing", async () => {
    const discovery = {
      explore: vi.fn().mockResolvedValue({ items: [], personalized: false }),
      visitorHash: vi.fn().mockReturnValue("visitor-hash"),
    };
    const controller = new PublicDiscoveryController(discovery as never);
    const response = { setHeader: vi.fn(), vary: vi.fn() };
    const request = {};

    await controller.explore({ page: 1, pageSize: 20, personalized: false }, request as never, response as never);

    expect(discovery.explore).toHaveBeenCalledWith(expect.objectContaining({ personalized: false }), undefined, "visitor-hash");
    expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "private, max-age=15, stale-while-revalidate=30");
    expect(response.setHeader).toHaveBeenCalledWith("Server-Timing", expect.stringMatching(/^explore;dur=/));
    expect(response.vary).toHaveBeenCalledWith("Cookie");
    expect(response.vary).toHaveBeenCalledWith("User-Agent");
  });
});
