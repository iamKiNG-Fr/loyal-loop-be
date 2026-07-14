import { describe, expect, it } from "vitest";
import { BusinessCapability, BusinessRole } from "../../generated/prisma/client";
import { ALL_CAPABILITIES, resolveCapabilities } from "./capabilities";

describe("resolveCapabilities", () => {
  it("always preserves every owner capability", () => {
    expect(resolveCapabilities(BusinessRole.OWNER, [
      { capability: BusinessCapability.SETTINGS_WRITE, allowed: false },
    ])).toEqual(ALL_CAPABILITIES);
  });

  it("applies explicit staff allow and deny overrides", () => {
    const resolved = resolveCapabilities(BusinessRole.DELIVERY, [
      { capability: BusinessCapability.DELIVERY_WRITE, allowed: false },
      { capability: BusinessCapability.CATALOG_WRITE, allowed: true },
    ]);
    expect(resolved).toContain(BusinessCapability.CATALOG_WRITE);
    expect(resolved).not.toContain(BusinessCapability.DELIVERY_WRITE);
    expect(resolved).not.toContain(BusinessCapability.PERMISSION_ADMIN);
  });
});

