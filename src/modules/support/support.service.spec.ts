import { describe, expect, it, vi } from "vitest";
import { SupportService } from "./support.service";

const auth = { businessId: "shop", userId: "owner" } as never;

function harness() {
  const prisma = { supportRequest: { create: vi.fn(async ({ data }) => ({ id: "req", ...data })) } };
  return { prisma, service: new SupportService(prisma as never) };
}

describe("SupportService", () => {
  it("keeps existing support messages as SUPPORT when no kind is sent", async () => {
    const { prisma, service } = harness();
    await service.create(auth, { topic: " Delivery ", message: " Rider is late " });
    expect(prisma.supportRequest.create).toHaveBeenCalledWith({
      data: { businessId: "shop", topic: "Delivery", message: "Rider is late", kind: "SUPPORT" },
    });
  });

  it("stores owner feedback as FEEDBACK for the business that sent it", async () => {
    const { prisma, service } = harness();
    await service.create(auth, { topic: "An idea", message: "Let me schedule posts", kind: "FEEDBACK" as never });
    expect(prisma.supportRequest.create.mock.calls[0][0].data).toMatchObject({ businessId: "shop", kind: "FEEDBACK" });
  });
});
