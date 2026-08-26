import { describe, expect, it, vi } from "vitest";
import { assessProductTextModeration, mediaAssetCanPublish, ProductsService } from "./products.service";

const approvedGeneralAsset = {
  contentRating: "GENERAL",
  moderationStatus: "AUTO_APPROVED",
  qualityStatus: "PASS",
  status: "ACTIVE",
};

describe("product media publishing safety", () => {
  it("allows approved general media", () => {
    expect(mediaAssetCanPublish(approvedGeneralAsset)).toBe(true);
  });

  it.each([
    { ...approvedGeneralAsset, contentRating: "SENSITIVE_18" },
    { ...approvedGeneralAsset, moderationStatus: "REVIEW_REQUIRED" },
    { ...approvedGeneralAsset, qualityStatus: "FAIL" },
    { ...approvedGeneralAsset, status: "DELETED" },
  ])("keeps sensitive, pending, failed, or deleted media private", (asset) => {
    expect(mediaAssetCanPublish(asset)).toBe(false);
  });
});

describe("product text publishing safety", () => {
  it("approves ordinary catalog copy", () => {
    expect(assessProductTextModeration({
      attributes: { searchTags: "blue, handmade" },
      category: "Fashion",
      description: "A hand-finished cotton shirt for everyday wear.",
      name: "Indigo day shirt",
    })).toEqual({ categories: [], decision: "approve", rating: "GENERAL" });
  });

  it("holds controlled goods added through an update field", () => {
    expect(assessProductTextModeration({
      attributes: { searchTags: "limited, cocaine" },
      category: "Collectibles",
      description: "Updated after the original safe listing was approved.",
      name: "Collector pack",
    })).toEqual({
      categories: ["Controlled substances"],
      decision: "review",
      rating: "SENSITIVE_18",
    });
  });

  it("rejects explicitly pornographic listing text", () => {
    expect(assessProductTextModeration({ name: "Explicit pornography bundle" })).toEqual({
      categories: ["Explicit sexual content"],
      decision: "reject",
      rating: "PROHIBITED",
    });
  });
});

describe("product removal", () => {
  it("archives and remembers the listing state instead of deleting historical relations", async () => {
    const prisma = {
      product: {
        findFirst: vi.fn().mockResolvedValue({
          businessId: "business-1",
          id: "product-1",
          status: "ACTIVE",
          variants: [],
          visibility: "PUBLIC",
        }),
        update: vi.fn().mockResolvedValue({ id: "product-1", status: "ARCHIVED", visibility: "PRIVATE" }),
      },
    };
    const service = new ProductsService(prisma as never, {} as never);

    await service.archive({ businessId: "business-1" } as never, "product-1");

    expect(prisma.product.findFirst).toHaveBeenCalledWith({
      where: { businessId: "business-1", id: "product-1" },
      include: { variants: true },
    });
    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: {
        archivedFromStatus: "ACTIVE",
        archivedFromVisibility: "PUBLIC",
        status: "ARCHIVED",
        visibility: "PRIVATE",
      },
    });
  });

  it("does not overwrite the saved state when archive is repeated", async () => {
    const prisma = {
      product: {
        findFirst: vi.fn().mockResolvedValue({
          archivedFromStatus: "DRAFT",
          archivedFromVisibility: "PRIVATE",
          businessId: "business-1",
          id: "product-1",
          status: "ARCHIVED",
          variants: [],
          visibility: "PRIVATE",
        }),
        update: vi.fn().mockResolvedValue({ id: "product-1", status: "ARCHIVED", visibility: "PRIVATE" }),
      },
    };
    const service = new ProductsService(prisma as never, {} as never);

    await service.archive({ businessId: "business-1" } as never, "product-1");

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: { status: "ARCHIVED", visibility: "PRIVATE" },
    });
  });

  it("restores the exact pre-archive status and visibility", async () => {
    const prisma = {
      product: {
        findFirst: vi.fn().mockResolvedValue({
          archivedFromStatus: "DRAFT",
          archivedFromVisibility: "PRIVATE",
          businessId: "business-1",
          id: "product-1",
          status: "ARCHIVED",
          variants: [],
          visibility: "PRIVATE",
        }),
        update: vi.fn().mockResolvedValue({ id: "product-1", status: "DRAFT", visibility: "PRIVATE" }),
      },
    };
    const service = new ProductsService(prisma as never, {} as never);

    await service.restore({ businessId: "business-1" } as never, "product-1");

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: {
        archivedFromStatus: null,
        archivedFromVisibility: null,
        status: "DRAFT",
        visibility: "PRIVATE",
      },
    });
  });

  it("restores legacy archived rows conservatively when no saved state exists", async () => {
    const prisma = {
      product: {
        findFirst: vi.fn().mockResolvedValue({
          archivedFromStatus: null,
          archivedFromVisibility: null,
          businessId: "business-1",
          id: "product-1",
          status: "ARCHIVED",
          variants: [],
          visibility: "PRIVATE",
        }),
        update: vi.fn().mockResolvedValue({ id: "product-1", status: "DRAFT", visibility: "PRIVATE" }),
      },
    };
    const service = new ProductsService(prisma as never, {} as never);

    await service.restore({ businessId: "business-1" } as never, "product-1");

    expect(prisma.product.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT", visibility: "PRIVATE" }),
    }));
  });

  it("rechecks publishing safety before restoring a public active listing", async () => {
    const prisma = {
      product: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({
            archivedFromStatus: "ACTIVE",
            archivedFromVisibility: "PUBLIC",
            businessId: "business-1",
            id: "product-1",
            status: "ARCHIVED",
            variants: [],
            visibility: "PRIVATE",
          })
          .mockResolvedValueOnce({
            images: [{ asset: approvedGeneralAsset }],
            media: [],
          }),
        update: vi.fn().mockResolvedValue({ id: "product-1", status: "ACTIVE", visibility: "PUBLIC" }),
      },
    };
    const service = new ProductsService(prisma as never, {} as never);

    await service.restore({ businessId: "business-1" } as never, "product-1");

    expect(prisma.product.update).toHaveBeenCalledWith({
      where: { id: "product-1" },
      data: {
        archivedFromStatus: null,
        archivedFromVisibility: null,
        status: "ACTIVE",
        visibility: "PUBLIC",
      },
    });
  });

  it("rejects restore for a product that is not archived", async () => {
    const prisma = {
      product: {
        findFirst: vi.fn().mockResolvedValue({
          businessId: "business-1",
          id: "product-1",
          status: "ACTIVE",
          variants: [],
          visibility: "PUBLIC",
        }),
      },
    };
    const service = new ProductsService(prisma as never, {} as never);

    await expect(service.restore({ businessId: "business-1" } as never, "product-1"))
      .rejects.toThrow("Product is not archived");
  });
});
