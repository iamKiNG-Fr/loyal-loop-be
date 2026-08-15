import { describe, expect, it } from "vitest";
import { assessProductTextModeration, mediaAssetCanPublish } from "./products.service";

const approvedGeneralAsset = {
  contentRating: "GENERAL",
  moderationStatus: "AUTO_APPROVED",
  qualityStatus: "PASS",
  status: "ACTIVE",
};

describe("product media publishing safety", () => {
  it("allows approved general media", () => {
    expect(mediaAssetCanPublish(approvedGeneralAsset)).toBe(true);
  });

  it.each([
    { ...approvedGeneralAsset, contentRating: "SENSITIVE_18" },
    { ...approvedGeneralAsset, moderationStatus: "REVIEW_REQUIRED" },
    { ...approvedGeneralAsset, qualityStatus: "FAIL" },
    { ...approvedGeneralAsset, status: "DELETED" },
  ])("keeps sensitive, pending, failed, or deleted media private", (asset) => {
    expect(mediaAssetCanPublish(asset)).toBe(false);
  });
});

describe("product text publishing safety", () => {
  it("approves ordinary catalog copy", () => {
    expect(assessProductTextModeration({
      attributes: { searchTags: "blue, handmade" },
      category: "Fashion",
      description: "A hand-finished cotton shirt for everyday wear.",
      name: "Indigo day shirt",
    })).toEqual({ categories: [], decision: "approve", rating: "GENERAL" });
  });

  it("holds controlled goods added through an update field", () => {
    expect(assessProductTextModeration({
      attributes: { searchTags: "limited, cocaine" },
      category: "Collectibles",
      description: "Updated after the original safe listing was approved.",
      name: "Collector pack",
    })).toEqual({
      categories: ["Controlled substances"],
      decision: "review",
      rating: "SENSITIVE_18",
    });
  });

  it("rejects explicitly pornographic listing text", () => {
    expect(assessProductTextModeration({ name: "Explicit pornography bundle" })).toEqual({
      categories: ["Explicit sexual content"],
      decision: "reject",
      rating: "PROHIBITED",
    });
  });
});
