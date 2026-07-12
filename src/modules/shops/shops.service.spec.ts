import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ShopsService } from "./shops.service";

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
  const findUnique = vi.fn()
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce(after ?? (initial ? request("CANCELED") : null));
  const updateMany = vi.fn().mockResolvedValue({ count: updateCount });
  const prisma = { orderRequest: { findUnique, updateMany } };
  const service = new ShopsService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { findUnique, service, updateMany };
}

describe("ShopsService.cancelRequestByToken", () => {
  it.each(["SENT", "ACCEPTED", "NEEDS_CHANGES"])("atomically cancels %s requests", async (status) => {
    const { service, updateMany } = serviceFor(request(status));

    const result = await service.cancelRequestByToken("public-token");

    expect(result.status).toBe("CANCELED");
    expect(result).not.toHaveProperty("tokenHash");
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "CANCELED" },
      where: expect.objectContaining({
        id: "request-1",
        status: { in: ["SENT", "ACCEPTED", "NEEDS_CHANGES"] },
      }),
    }));
  });

  it("is idempotent when the request is already canceled", async () => {
    const { service, updateMany } = serviceFor(request("CANCELED"));

    const result = await service.cancelRequestByToken("public-token");

    expect(result.status).toBe("CANCELED");
    expect(result).not.toHaveProperty("tokenHash");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it.each([
    request("CONVERTED"),
    request("SENT", { id: "sale-1" }),
  ])("rejects a request that has become an order", async (existing) => {
    const { service, updateMany } = serviceFor(existing);

    await expect(service.cancelRequestByToken("public-token")).rejects.toBeInstanceOf(BadRequestException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("rejects when conversion wins the conditional-update race", async () => {
    const { service } = serviceFor(request("SENT"), undefined, 0);

    await expect(service.cancelRequestByToken("public-token")).rejects.toThrow("can no longer be canceled");
  });

  it("does not reveal whether an unknown token maps to another resource", async () => {
    const { service } = serviceFor(null);

    await expect(service.cancelRequestByToken("unknown-token")).rejects.toBeInstanceOf(NotFoundException);
  });
});
