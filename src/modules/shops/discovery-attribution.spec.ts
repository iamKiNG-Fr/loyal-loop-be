import { describe, expect, it } from "vitest";
import { discoverySource, toDiscoveryAttribution } from "./discovery-attribution";

describe("discovery attribution", () => {
  it("accepts the bounded share contract", () => {
    expect(toDiscoveryAttribution({
      utm_campaign: "shop_share",
      utm_medium: "social",
      utm_source: "whatsapp",
    })).toEqual({ campaign: "shop_share", medium: "social", source: "whatsapp" });
  });

  it("rejects arbitrary sources and campaigns", () => {
    expect(toDiscoveryAttribution({
      utm_campaign: "free-form",
      utm_medium: "social",
      utm_source: "tracker",
    })).toBeUndefined();
  });

  it("reads only known sources from stored event metadata", () => {
    expect(discoverySource({ attribution: { source: "instagram" } })).toBe("instagram");
    expect(discoverySource({ attribution: { source: "unknown" } })).toBeUndefined();
  });
});
