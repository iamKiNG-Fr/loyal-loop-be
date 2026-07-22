import { describe, expect, it } from "vitest";
import {
  discoverableProductWhere,
  discoverableShowcaseWhere,
  publicMediaAssetWhere,
} from "./public-media";

describe("public media eligibility", () => {
  it("requires approved, general-audience, non-failed media", () => {
    expect(publicMediaAssetWhere).toEqual({
      contentRating: "GENERAL",
      moderationStatus: { in: ["AUTO_APPROVED", "MANUALLY_APPROVED"] },
      qualityStatus: { not: "FAIL" },
      status: "ACTIVE",
    });
  });

  it("requires safe media for both discoverable products and Showcases", () => {
    expect(discoverableProductWhere.contentRating).toBe("GENERAL");
    expect(discoverableProductWhere.OR).toHaveLength(2);
    expect(discoverableShowcaseWhere).toEqual({
      asset: { is: publicMediaAssetWhere },
      contentRating: "GENERAL",
      status: "PUBLISHED",
    });
  });
});
