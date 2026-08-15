import { describe, expect, it } from "vitest";
import { mediaAssetCanPublish } from "./products.service";

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
