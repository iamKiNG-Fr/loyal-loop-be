import { describe, expect, it } from "vitest";
import { Prisma } from "../../generated/prisma/client";
import { statusFromAmounts } from "./sales.service";

describe("sale payment status", () => {
  it("derives status from decimal amounts without floating-point math", () => {
    expect(
      statusFromAmounts(new Prisma.Decimal("0"), new Prisma.Decimal("100.00")),
    ).toBe("UNPAID");
    expect(
      statusFromAmounts(new Prisma.Decimal("40"), new Prisma.Decimal("100.00")),
    ).toBe("PARTIAL");
    expect(
      statusFromAmounts(new Prisma.Decimal("100"), new Prisma.Decimal("100.00")),
    ).toBe("PAID");
  });
});
