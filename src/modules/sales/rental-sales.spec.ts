import { describe, expect, it, vi } from "vitest";
import { Prisma } from "../../generated/prisma/client";
import { quoteRental } from "../../common/rental";
import { SalesService } from "./sales.service";

function setup() {
  const product = { id: "chairs", name: "Chairs", currency: "NGN", price: new Prisma.Decimal("12.25"), stockCount: 3, status: "ACTIVE", attributes: { rentalUnit: "HOUR" }, variants: [], images: [] };
  let saved: any;
  const db: any = {
    customer: { findFirst: vi.fn().mockResolvedValue({ id: "customer" }), update: vi.fn() },
    product: { findMany: vi.fn().mockResolvedValue([product]), update: vi.fn().mockResolvedValue(product), updateMany: vi.fn() },
    saleItem: { findMany: vi.fn().mockResolvedValue([]) },
    businessPreferences: { findUnique: vi.fn().mockResolvedValue({ currency: "NGN", rentalPolicy: "Return clean" }) },
    orderRequest: { findFirst: vi.fn(), update: vi.fn() },
    sale: { create: vi.fn(async ({ data }) => { saved = { id: "sale", ...data, paymentProofs: [] }; return saved; }), findUniqueOrThrow: vi.fn(async () => saved) },
    salePaymentInstruction: { create: vi.fn() }, receipt: { create: vi.fn().mockResolvedValue({ id: "receipt" }) }, delivery: { create: vi.fn().mockResolvedValue({ id: "delivery" }) },
  };
  db.$transaction = vi.fn((run: any) => run(db));
  const service = new SalesService(db, { record: vi.fn() } as never, { enqueueDelivery: vi.fn().mockResolvedValue(null) } as never, { captureIfQualified: vi.fn() } as never, {} as never);
  const dto: any = { customerId: "customer", fulfillment: "DELIVERY", items: [{ productId: "chairs", name: "Ignored", quantity: 2, unitPrice: "0.01", rentalStartAt: "2099-01-01T10:00:00Z", rentalEndAt: "2099-01-01T12:01:00Z" }] };
  return { db, service, dto, product };
}
const auth: any = { businessId: "shop", userId: "owner" };
describe("rental sale creation", () => {
  it("calculates server-side duration prices and reserves capacity without consuming sale stock", async () => {
    const { db, service, dto } = setup();
    const result = await service.create(auth, dto);
    expect(result.sale.total.toString()).toBe("73.5");
    const line = db.sale.create.mock.calls[0][0].data.items.create[0];
    expect(line.rental).toMatchObject({ units: 3, rate: "12.25", unitPrice: "36.75" });
    expect(line.inventorySource).toBeUndefined(); expect(db.product.updateMany).not.toHaveBeenCalled();
    expect(db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });
  it("preserves the customer's agreed rate, dates and policy despite later listing changes", async () => {
    const { db, service, dto } = setup();
    const agreed = quoteRental("HOUR", "10", "2099-01-01T10:00:00Z", "2099-01-01T12:00:00Z", { rentalPolicy: "Original return terms" });
    db.orderRequest.findFirst.mockResolvedValue({ items: [{ id: "requested", productId: "chairs", variantId: null, quantity: 2, rental: agreed }] });
    dto.sourceRequestId = "request";
    const result = await service.create(auth, dto);
    expect(result.sale.total.toString()).toBe("40");
    expect(db.sale.create.mock.calls[0][0].data.items.create[0].rental).toEqual(agreed);
  });
  it("rejects a changed rental quantity when converting the customer's request", async () => {
    const { db, service, dto } = setup();
    db.orderRequest.findFirst.mockResolvedValue({ items: [{ id: "requested", productId: "chairs", variantId: null, quantity: 1, rental: quoteRental("HOUR", "10", dto.items[0].rentalStartAt, dto.items[0].rentalEndAt) }] });
    dto.sourceRequestId = "request";
    await expect(service.create(auth, dto)).rejects.toThrow("customer-approved request");
    expect(db.sale.create).not.toHaveBeenCalled();
  });
});
