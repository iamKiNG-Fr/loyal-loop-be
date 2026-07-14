import type { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { IntelligenceService } from "./intelligence.service";

describe("IntelligenceService deterministic fallback", () => {
  const service = new IntelligenceService({
    get(_key: string, fallback?: string) { return fallback; },
  } as ConfigService, {
    discoveryTelemetry: { create: () => Promise.resolve(null) },
  } as never);

  it("extracts only explicit hard constraints when Gemini is disabled", async () => {
    const plan = await service.parseDiscoveryQuery("available black dress under NGN 40,000");
    expect(plan.mode).toBe("fallback");
    expect(plan.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "maxPrice", value: 40000 }),
      expect.objectContaining({ key: "inStock", value: true }),
    ]));
  });

  it("keeps evidence-linked customer history available without Gemini", async () => {
    const summary = await service.summarizeCustomer({
      customerName: "Ada",
      evidence: [{ id: "sale-1", kind: "sale", occurredAt: "2026-07-14T10:00:00.000Z", title: "Bought a dress" }],
    });
    expect(summary.evidenceIds).toEqual(["sale-1"]);
    expect(summary.summary).toContain("Bought a dress");
  });
});
