import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { DeliveryService } from "./delivery.service";

describe("private handoff confirmation", () => {
  const auth = { businessId: "shop-1", userId: "owner-1" } as never;
  const secret = "test-only-handoff-secret";
  const code = (createHmac("sha256", secret).update("delivery-handoff:delivery-1").digest().readUInt32BE(0) % 1_000_000).toString().padStart(6, "0");
  function fixture(status: string, method = "CUSTOMER_PICKUP") {
    const delivery = {id:"delivery-1",businessId:"shop-1",saleId:"sale-1",customerId:"customer-1",status,journeyMethod:method,handoffCodeIssuedAt:new Date()};
    const update = vi.fn().mockResolvedValue({...delivery,status:"CONFIRMED"});
    const tx = { delivery: { update } };
    const prisma = { delivery: {findFirst: vi.fn().mockResolvedValue(delivery)}, $transaction: vi.fn(callback => callback(tx)) };
    const service = new DeliveryService(prisma as never, {record:vi.fn()} as never, {enqueueCustomerMemoryPrompt:vi.fn().mockResolvedValue(null)} as never, new ConfigService({SESSION_HASH_SECRET:secret}), {captureIfQualified:vi.fn().mockResolvedValue(null)} as never, {} as never);
    return {service,prisma,update};
  }
  it("accepts the customer's six-digit pickup code and scopes the lookup to the shop", async () => {
    const {service,prisma,update}=fixture("READY_FOR_PICKUP");
    await expect(service.confirmHandoff(auth,"delivery-1",{code})).resolves.toMatchObject({status:"CONFIRMED"});
    expect(prisma.delivery.findFirst.mock.calls[0][0].where).toMatchObject({businessId:"shop-1",id:"delivery-1"});
    expect(update.mock.calls[0][0].where).toEqual({id:"delivery-1",status:"READY_FOR_PICKUP"});
  });
  it.each([["CONFIRMED","CUSTOMER_PICKUP"],["IN_TRANSIT","SHOP_DELIVERY"],["READY_FOR_PICKUP","CUSTOMER_RIDER"]])("refuses replay or early confirmation in %s / %s", async (status,method) => {
    const {service,update}=fixture(status,method);
    await expect(service.confirmHandoff(auth,"delivery-1",{code})).rejects.toThrow(/not expected/);
    expect(update).not.toHaveBeenCalled();
  });
  it("rejects an incorrect code without completing the delivery", async () => {
    const {service,update}=fixture("DELIVERED","SHOP_DELIVERY");
    await expect(service.confirmHandoff(auth,"delivery-1",{code:code==='000000'?'111111':'000000'})).rejects.toThrow(/incorrect/);
    expect(update).not.toHaveBeenCalled();
  });
});
