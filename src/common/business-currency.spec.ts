import { ConfigService } from "@nestjs/config";
import { describe, it, expect, vi } from "vitest";
import { assertSameCurrency, businessCurrency, businessRegions } from "./business-currency";
import { BusinessesService } from "../modules/businesses/businesses.service";

describe("business currency integrity", () => {
  it("uses distinct regional defaults and refuses mixed currency records", () => {
    expect(businessRegions.GH).toEqual({ currency: "GHS", timezone: "Africa/Accra" });
    expect(businessRegions.KE.currency).toBe("KES");
    expect(businessCurrency(" ghs ")).toBe("GHS");
    expect(() => businessCurrency("XXX")).toThrow();
    expect(() => assertSameCurrency("KES", "NGN")).toThrow(/shop currency/);
  });
  it.each(["product", "sale", "orderRequest", "businessPaymentAccount"])("prevents relabelling a shop with existing %s records", async (record) => {
    const upsert = vi.fn();
    const tx: any = { businessPreferences: { findUnique: vi.fn().mockResolvedValue({ currency: "NGN" }), upsert } };
    for (const name of ["product", "sale", "orderRequest", "businessPaymentAccount"]) tx[name] = { count: vi.fn().mockResolvedValue(name === record ? 1 : 0) };
    const prisma = { ...tx, $transaction: vi.fn(callback => callback(tx)) };
    const service = new BusinessesService(prisma as never, new ConfigService(), {} as never);
    await expect(service.updatePreferences({ businessId: "shop-1" } as never, { currency: "GHS" })).rejects.toThrow(/Existing amounts/);
    expect(upsert).not.toHaveBeenCalled();
    expect(prisma.$transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: "Serializable" });
  });
  it("allows a new shop to select KES before commerce starts", async () => {
    const upsert = vi.fn().mockResolvedValue({ currency: "KES" });
    const tx: any = { businessPreferences: { findUnique: vi.fn().mockResolvedValue({ currency: "NGN" }), upsert } };
    for (const name of ["product", "sale", "orderRequest", "businessPaymentAccount"]) tx[name] = { count: vi.fn().mockResolvedValue(0) };
    const service = new BusinessesService({ $transaction: (callback: any) => callback(tx) } as never, new ConfigService(), {} as never);
    await expect(service.updatePreferences({ businessId: "shop-1" } as never, { currency: "KES" })).resolves.toEqual({ currency: "KES" });
  });
});
