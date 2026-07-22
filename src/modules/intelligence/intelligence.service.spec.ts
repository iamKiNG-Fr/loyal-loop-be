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
    const brief = await service.summarizeCustomer({
      businessName: "Ada's Wardrobe",
      customerName: "Ada",
      evidence: [{ id: "sale-1", kind: "sale", occurredAt: "2026-07-14T10:00:00.000Z", title: "Bought a dress" }],
    });
    expect(brief.evidenceIds).toEqual(["sale-1"]);
    expect(brief.overview).toContain("Bought a dress");
    expect(brief.recommendedAction).toContain("Ada");
    expect(brief.source).toBe("fallback");
  });

  it("turns an open customer issue into a specific next action", async () => {
    const brief = await service.summarizeCustomer({
      businessName: "Ada's Wardrobe",
      customerName: "Chidi",
      evidence: [
        { id: "issue-1", kind: "issue", occurredAt: "2026-07-15T10:00:00.000Z", title: "Open customer issue: wrong size delivered" },
        { id: "open-1", kind: "activity", occurredAt: "2026-07-14T10:00:00.000Z", title: "Receipt RCP-1 opened" },
        { id: "open-2", kind: "activity", occurredAt: "2026-07-14T09:00:00.000Z", title: "Receipt RCP-1 opened" },
      ],
    });

    expect(brief.headline).toContain("issue");
    expect(brief.recommendedAction).toContain("Chidi");
    expect(brief.evidenceIds).toEqual(["issue-1", "open-1"]);
  });

  it("suggests product option axes without inventing option values", async () => {
    const guidance = await service.suggestProductFormGuidance({
      availableCategories: ["Food & drinks", "Fashion"],
      category: "Food & drinks",
      contentRating: "GENERAL",
      currentDescription: "A celebration cake.",
      mediaCount: 1,
      name: "Big Cake",
      optionCount: 0,
      optionNames: [],
      placement: "Standard listing",
      price: "12000",
      stock: "4",
    });

    expect(guidance.source).toBe("fallback");
    expect(guidance.recommendations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "SET_UP_OPTIONS",
        optionAxes: expect.arrayContaining(["Size", "Flavour"]),
      }),
    ]));
    expect(JSON.stringify(guidance)).not.toContain("Vanilla");
  });
});
