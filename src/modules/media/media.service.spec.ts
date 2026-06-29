import { ConfigService } from "@nestjs/config";
import { describe, expect, it } from "vitest";
import { MediaService } from "./media.service";

describe("MediaService", () => {
  it("signs a business-owned Cloudinary upload without exposing the secret", () => {
    const config = new ConfigService({
      CLOUDINARY_CLOUD_NAME: "loyal-loop-test",
      CLOUDINARY_API_KEY: "public-key",
      CLOUDINARY_API_SECRET: "private-secret",
    });
    const service = new MediaService({} as never, config);
    const result = service.createUploadSignature(
      {
        businessId: "business-1",
        userId: "user-1",
        sessionId: "session-1",
        role: "OWNER",
      },
      { purpose: "PRODUCT_IMAGE" },
    );

    expect(result.folder).toBe(
      "loyal-loop/businesses/business-1/product_image",
    );
    expect(result.publicId).toMatch(/^[a-f0-9]{24}$/);
    expect(result).not.toHaveProperty("apiSecret");
    expect(result.signature).toMatch(/^[a-f0-9]{40}$/);
  });
});
