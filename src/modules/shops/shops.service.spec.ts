import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { assertProductsLaunched, ShopsService } from "./shops.service";

function request(status: string, convertedSale: object | null = null) {
  return {
    id: "request-1",
    status,
    tokenHash: "private-token-hash",
    convertedSale,
    business: { name: "Fixture Shop", slug: "fixture-shop" },
    items: [],
  };
}

function serviceFor(initial: ReturnType<typeof request> | null, after?: ReturnType<typeof request> | null, updateCount = 1) {
  const findFirst = vi.fn().mockResolvedValue(initial);
  const findUnique = vi.fn()
    .mockResolvedValue(after ?? (initial ? request("CANCELED") : null));
  const updateMany = vi.fn().mockResolvedValue({ count: updateCount });
  const prisma = { orderRequest: { findFirst, findUnique, updateMany } };
  const releaseForRequest = vi.fn().mockResolvedValue({ count: 1 });
  const enqueueOrderRequestStatus = vi.fn().mockResolvedValue(undefined);
  const service = new ShopsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { releaseForRequest } as never,
    { enqueueOrderRequestStatus } as never,
  );
  return { enqueueOrderRequestStatus, findFirst, findUnique, releaseForRequest, service, updateMany };
}

describe("ShopsService.cancelRequestByToken", () => {
  it.each(["SENT", "ACCEPTED", "NEEDS_CHANGES"])("atomically cancels %s requests", async (status) => {
    const { service, updateMany } = serviceFor(request(status));

    const result = await service.cancelRequestByToken("customer-1", "public-token");

    expect(result.status).toBe("CANCELED");
    expect(result).not.toHaveProperty("tokenHash");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "CANCELED",
        cancellationReasonCode: "CUSTOMER_CHANGED_MIND",
        canceledBy: "CUSTOMER",
      }),
      where: expect.objectContaining({
        id: "request-1",
        status: { in: ["SENT", "ACCEPTED", "NEEDS_CHANGES"] },
      }),
    }));
  });

  it("is idempotent when the request is already canceled", async () => {
    const { service, updateMany } = serviceFor(request("CANCELED"));

    const result = await service.cancelRequestByToken("customer-1", "public-token");

    expect(result.status).toBe("CANCELED");
    expect(result).not.toHaveProperty("tokenHash");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    request("CONVERTED"),
    request("SENT", { id: "sale-1" }),
  ])("rejects a request that has become an order", async (existing) => {
    const { service, updateMany } = serviceFor(existing);

    await expect(service.cancelRequestByToken("customer-1", "public-token")).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects when conversion wins the conditional-update race", async () => {
    const { service } = serviceFor(request("SENT"), undefined, 0);

    await expect(service.cancelRequestByToken("customer-1", "public-token")).rejects.toThrow("can no longer be canceled");
  });

  it("does not reveal whether an unknown token maps to another resource", async () => {
    const { service } = serviceFor(null);

    await expect(service.cancelRequestByToken("customer-1", "unknown-token")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("product launch request guards", () => {
  it("allows launched products and blocks a future drop", () => {
    const now = new Date("2026-08-15T12:00:00.000Z");
    expect(() => assertProductsLaunched([
      { launchAt: new Date("2026-08-15T11:59:00.000Z"), name: "Live product" },
    ], now)).not.toThrow();
    expect(() => assertProductsLaunched([
      { launchAt: new Date("2026-08-16T12:00:00.000Z"), name: "Sunday drop" },
    ], now)).toThrow("Sunday drop has not launched yet");
  });
});

describe("ShopsService.getPublicShop", () => {
  it("loads the catalogue and trust summary concurrently", async () => {
    let resolveBusiness: ((value: object) => void) | undefined;
    const businessPromise = new Promise<object>((resolve) => {
      resolveBusiness = resolve;
    });
    const trust = { level: 1 };
    const trustSummary = vi.fn().mockResolvedValue(trust);
    const prisma = {
      business: { findFirst: vi.fn().mockReturnValue(businessPromise) },
      commerceEvent: { create: vi.fn().mockResolvedValue({ id: "event-1" }) },
    };
    const businesses = {
      reconcileScheduledLaunch: vi.fn().mockResolvedValue(false),
      resolveShopSlug: vi.fn().mockResolvedValue({ id: "business-1", redirectedFrom: null }),
    };
    const service = new ShopsService(
      prisma as never,
      {} as never,
      {} as never,
      { summary: trustSummary } as never,
      {} as never,
      businesses as never,
      {} as never,
      {} as never,
    );

    const resultPromise = service.getPublicShop("fixture-shop");
    await vi.waitFor(() => expect(trustSummary).toHaveBeenCalledWith("business-1", false));
    resolveBusiness?.({
      _count: { products: 0 },
      contacts: [],
      coverAsset: null,
      id: "business-1",
      launchProduct: null,
      logoAsset: null,
      name: "Fixture Shop",
      preferences: null,
      products: [],
      publicCardId: "LL-FIXTURE",
      showcases: [],
      slug: "fixture-shop",
      storeStatus: "OPEN",
    });

    await expect(resultPromise).resolves.toMatchObject({
      catalog: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
      canonicalSlug: "fixture-shop",
      trust,
    });
    expect(prisma.business.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        products: expect.objectContaining({ take: 12 }),
      }),
    }));
  });

  it("emits phase timings without putting view analytics on the read path", async () => {
    const timing = vi.fn();
    const commerceCreate = vi.fn();
    const service = new ShopsService(
      {
        business: { findFirst: vi.fn().mockResolvedValue({
          _count: { products: 0 },
          contacts: [],
          coverAsset: null,
          id: "business-1",
          launchProduct: null,
          logoAsset: null,
          name: "Fixture Shop",
          preferences: null,
          products: [],
          publicCardId: "LL-FIXTURE",
          showcases: [],
          slug: "fixture-shop",
          storeStatus: "OPEN",
        }) },
        commerceEvent: { create: commerceCreate },
      } as never,
      {} as never,
      {} as never,
      { summary: vi.fn().mockResolvedValue({ level: 1 }) } as never,
      {} as never,
      {
        reconcileScheduledLaunch: vi.fn().mockResolvedValue(false),
        resolveShopSlug: vi.fn().mockResolvedValue({ id: "business-1", redirectedFrom: null }),
      } as never,
      {} as never,
      {} as never,
    );

    await service.getPublicShop("fixture-shop", timing);

    expect(timing.mock.calls.map(([phase]) => phase)).toEqual(expect.arrayContaining([
      "slug",
      "launch",
      "catalog",
      "trust",
    ]));
    expect(commerceCreate).not.toHaveBeenCalled();
  });

  it("keeps a paused shop browseable while marking new requests unavailable", async () => {
    const product = { id: "product-1", images: [], name: "Browse me" };
    const service = new ShopsService(
      {
        business: { findFirst: vi.fn().mockResolvedValue({
          _count: { products: 1 },
          contacts: [],
          coverAsset: null,
          id: "business-1",
          launchProduct: null,
          logoAsset: null,
          name: "Paused Shop",
          preferences: null,
          products: [product],
          publicCardId: "LL-PAUSED",
          showcases: [],
          slug: "paused-shop",
          storeStatus: "PAUSED",
        }) },
      } as never,
      {} as never,
      {} as never,
      { summary: vi.fn().mockResolvedValue({ level: 1 }) } as never,
      {} as never,
      {
        reconcileScheduledLaunch: vi.fn().mockResolvedValue(false),
        resolveShopSlug: vi.fn().mockResolvedValue({ id: "business-1", redirectedFrom: null }),
      } as never,
      {} as never,
      {} as never,
    );

    await expect(service.getPublicShop("paused-shop")).resolves.toMatchObject({
      canRequest: false,
      catalog: { total: 1 },
      products: [product],
    });
  });
});

describe("ShopsService.getPublicProduct", () => {
  it("resolves shared products by id, slug, or human-readable name", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      businessId: "business-1",
      business: { id: "business-1", name: "Fixture Shop", slug: "fixture-shop" },
      id: "product-25",
      images: [],
      name: "Product Twenty Five",
      slug: "product-twenty-five",
    });
    const service = new ShopsService(
      {
        commerceEvent: { create: vi.fn().mockResolvedValue({ id: "event-1" }) },
        product: { findFirst },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        reconcileScheduledLaunch: vi.fn().mockResolvedValue(false),
        resolveShopSlug: vi.fn().mockResolvedValue({ id: "business-1", redirectedFrom: null }),
      } as never,
      {} as never,
      {} as never,
    );

    await service.getPublicProduct("fixture-shop", "product-twenty-five");

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [
          { id: "product-twenty-five" },
          { slug: "product-twenty-five" },
          { name: { equals: "product-twenty-five", mode: "insensitive" } },
        ],
      }),
    }));
  });
});

describe("ShopsService order-choice responses", () => {
  function termsService() {
    const source = {
      agreedFulfillment: null,
      agreedPaymentMethod: null,
      businessId: "business-1",
      business: {
        preferences: {
          allowedFulfillmentMethods: ["DELIVERY", "PICKUP"],
          allowedPaymentMethods: ["BANK_TRANSFER", "CASH"],
        },
      },
      customerAccountId: "account-1",
      deliveryAddress: "1 Loop Street",
      fulfillment: "DELIVERY",
      id: "request-1",
      referenceCode: "REQ-1",
      requestedPaymentMethod: "BANK_TRANSFER",
      status: "NEEDS_CHANGES",
      termChanges: [{
        id: "change-1",
        proposedFulfillment: "PICKUP",
        proposedPaymentMethod: "CASH",
      }],
    };
    const updateTerms = vi.fn().mockResolvedValue({ count: 1 });
    const updateRequest = vi.fn().mockResolvedValue({ ...source, status: "SENT" });
    const tx = {
      activityEvent: { create: vi.fn() },
      customerOrderNotice: { updateMany: vi.fn() },
      orderRequest: { update: updateRequest },
      orderRequestPaymentChange: { create: vi.fn() },
      orderRequestTermChange: { updateMany: updateTerms },
    };
    const enqueueOrderRequestStatus = vi.fn();
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
      orderRequest: { findFirst: vi.fn().mockResolvedValue(source) },
    };
    const service = new ShopsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { enqueueOrderRequestStatus } as never,
    );
    return { enqueueOrderRequestStatus, service, tx, updateRequest, updateTerms };
  }

  it("lets the customer decline and retain the original choices", async () => {
    const { enqueueOrderRequestStatus, service, tx, updateRequest, updateTerms } = termsService();

    await service.respondToTermsChangeByToken("account-1", "token", { decision: "DECLINED" });

    expect(updateTerms).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DECLINED" }),
    }));
    expect(updateRequest).toHaveBeenCalledWith(expect.objectContaining({
      data: { ownerReadAt: null, status: "SENT" },
    }));
    expect(tx.orderRequestPaymentChange.create).not.toHaveBeenCalled();
    expect(enqueueOrderRequestStatus).not.toHaveBeenCalled();
  });

  it("records accepted choices without sending the acting customer a generic status message", async () => {
    const { enqueueOrderRequestStatus, service, tx, updateRequest } = termsService();

    await service.respondToTermsChangeByToken("account-1", "token", {
      decision: "ACCEPTED",
      fulfillment: "PICKUP",
      paymentMethod: "CASH",
    });

    expect(updateRequest).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        agreedFulfillment: "PICKUP",
        agreedPaymentMethod: "CASH",
        ownerReadAt: null,
        status: "SENT",
      },
    }));
    expect(tx.orderRequestPaymentChange.create).toHaveBeenCalledOnce();
    expect(enqueueOrderRequestStatus).not.toHaveBeenCalled();
  });
});
