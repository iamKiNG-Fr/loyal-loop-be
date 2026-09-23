import { describe, expect, it, vi } from "vitest";
import { productSupply } from "../../common/product-supply";
import { ProductsService } from "./products.service";

const auth = { businessId: "chef-shop", userId: "owner" } as never;
const base = { id: "meal", name: "Lunch bowl", category: "Chef", description: "Freshly prepared lunch", price: "4000", attributes: {}, status: "DRAFT", visibility: "PRIVATE", contentRating: "GENERAL", stockCount: 3, variants: [{ active: true, name: "Default", stockCount: 3 }], images: [], media: [] };

function fixture(existing = base) {
  const product = {
    findFirst: vi.fn().mockImplementation(({ select }) => Promise.resolve(select ? null : existing)),
    create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...base, ...data, images: [], media: [], variants: data.variants.create })),
    update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...existing, ...data, variants: data.variants?.create ?? existing.variants })),
  };
  const prisma = { product, mediaAsset: { findMany: vi.fn().mockResolvedValue([]) }, businessPreferences: { findUnique: vi.fn().mockResolvedValue({ currency: "NGN" }) }, $transaction: vi.fn() };
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  return { product, service: new ProductsService(prisma as never, { record: vi.fn() } as never) };
}

describe("made-to-order supply", () => {
  it("creates made-to-order product and option stock as untracked, ignoring stale inventory fields", async () => {
    const { service, product } = fixture();
    const result = await service.create(auth, { name: "Lunch bowl", price: "4000", category: "Chef", madeToOrder: true, stockCount: 0, variants: [{ name: "Large", optionValues: {}, stockCount: 50 }] });
    expect(product.create.mock.calls[0][0].data).toMatchObject({ attributes: { madeToOrder: true }, stockCount: null, variants: { create: [{ stockCount: null }] } });
    expect(result.listingReadiness.checks.find((check: any) => check.key === "availability")?.passed).toBe(true);
  });

  it("retains normal inventory validation for stocked Chef products", async () => {
    const { service, product } = fixture();
    await expect(service.create(auth, { name: "Lunch bowl", price: "4000", category: "Chef", madeToOrder: false, stockCount: 2, variants: [{ name: "Large", optionValues: {}, stockCount: 3 }] })).rejects.toThrow();
    expect(product.create).not.toHaveBeenCalled();
  });

  it("switches existing stock and every option to made-to-order atomically", async () => {
    const { service, product } = fixture();
    await service.update(auth, "meal", { madeToOrder: true });
    expect(product.update.mock.calls[0][0]).toMatchObject({ where: { id: "meal" }, data: { stockCount: null, attributes: { madeToOrder: true }, variants: { updateMany: { where: {}, data: { stockCount: null } } } } });
    expect(product.findFirst.mock.calls[0][0].where).toEqual({ businessId: "chef-shop", id: "meal" });
  });

  it("preserves supply mode and other attributes on partial metadata edits", () => {
    expect(productSupply({ attributes: { searchTags: "lunch" } }, { attributes: { madeToOrder: true, ingredients: "rice" } })).toEqual({ madeToOrder: true, stockCount: null, attributes: { madeToOrder: true, ingredients: "rice", searchTags: "lunch" } });
    expect(productSupply({ attributes: { madeToOrder: true }, stockCount: 3 }).madeToOrder).toBe(false);
  });

  it("requires stock when returning to stocked mode and accepts sold out", () => {
    const existing = { attributes: { madeToOrder: true } };
    expect(() => productSupply({ madeToOrder: false }, existing)).toThrow("Enter available stock");
    expect(() => productSupply({ madeToOrder: false, stockCount: null } as never, existing)).toThrow("Enter available stock");
    expect(productSupply({ madeToOrder: false, stockCount: 0 }, existing)).toMatchObject({ madeToOrder: false, stockCount: 0 });
  });
});
