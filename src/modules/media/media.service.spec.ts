import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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

  it("signs moderation and callback parameters only when moderation is enabled", () => {
    const config = new ConfigService({
      CLOUDINARY_API_KEY: "public-key",
      CLOUDINARY_API_SECRET: "private-secret",
      CLOUDINARY_CLOUD_NAME: "loyal-loop-test",
      CLOUDINARY_NOTIFICATION_URL: "https://api.example.com/api/v1/media/webhooks/cloudinary",
      MEDIA_MODERATION_MODE: "enforce",
      MEDIA_MODERATION_PROVIDER: "aws_rek",
    });
    const service = new MediaService({} as never, config);
    const result = service.createUploadSignature(
      { businessId: "business-1", capabilities: [], memberId: "member-1", role: "OWNER", sessionId: "session-1", userId: "user-1" },
      { purpose: "PRODUCT_IMAGE" },
    );

    expect(result.uploadParameters).toEqual({
      moderation: "aws_rek",
      notification_url: "https://api.example.com/api/v1/media/webhooks/cloudinary",
    });
  });

  it("verifies and applies a Cloudinary moderation notification idempotently", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      moderation: [{ kind: "aws_rek", status: "rejected", response: { moderation_labels: ["Explicit Nudity"] } }],
      public_id: "loyal-loop/businesses/business-1/product_image/asset-1",
      request_id: "event-1",
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = createHash("sha1")
      .update(Buffer.concat([rawBody, Buffer.from(timestamp), Buffer.from("private-secret")]))
      .digest("hex");
    const update = vi.fn(async ({ data }) => ({ id: "asset-1", ...data }));
    const prisma = {
      mediaAsset: {
        findUnique: vi.fn(async () => ({
          id: "asset-1",
          moderationEventId: null,
          moderationNotifiedAt: null,
          purpose: "PRODUCT_IMAGE",
        })),
        update,
      },
    };
    const service = new MediaService(prisma as never, new ConfigService({
      CLOUDINARY_API_SECRET: "private-secret",
      MEDIA_MODERATION_MODE: "enforce",
    }));

    await expect(service.handleCloudinaryNotification(rawBody, timestamp, signature, payload)).resolves.toEqual({
      assetId: "asset-1",
      matched: true,
      repeated: false,
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contentRating: "PROHIBITED",
        moderationEventId: "event-1",
        moderationStatus: "REJECTED",
      }),
    }));
  });
});
