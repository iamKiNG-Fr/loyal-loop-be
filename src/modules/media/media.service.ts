import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  OwnerAuthContext,
  PlatformAuthContext,
} from "../../common/request-context";
import {
  MediaContentRating,
  MediaModerationStatus,
  MediaPurpose,
  MediaQualityStatus,
  MediaReviewDecision,
  Prisma,
} from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  AppealMediaAssetDto,
  CreateUploadSignatureDto,
  MediaFailureTelemetryDto,
  RegisterMediaAssetDto,
  ReviewMediaAssetDto,
} from "./dto/media.dto";

const IMAGE_FORMATS = ["jpg", "jpeg", "png", "webp"];
const VIDEO_FORMATS = ["mp4", "mov", "webm"];
const PAYMENT_PROOF_MAX_BYTES = 5 * 1024 * 1024;

export type RegisteredUpload = {
  bytes: number;
  format: string;
  height?: number;
  durationSeconds?: number;
  mimeType?: string;
  resourceType?: string;
  originalFilename?: string;
  publicId: string;
  secureUrl: string;
  signature: string;
  version: string;
  width?: number;
  exactHash?: string;
  perceptualHash?: string;
  clientQualityMetrics?: Record<string, unknown>;
  providerQualityAnalysis?: Record<string, unknown>;
  providerModeration?: unknown[];
};

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  recordFailure(auth: OwnerAuthContext, dto: MediaFailureTelemetryDto) {
    return this.prisma.discoveryTelemetry.create({
      data: {
        type: "MEDIA_FAILURE",
        metadata: {
          businessId: auth.businessId,
          message: dto.message.trim().slice(0, 300),
          phase: dto.phase,
          purpose: dto.purpose,
        },
      },
    }).catch(() => null);
  }

  createUploadSignature(auth: OwnerAuthContext, dto: CreateUploadSignatureDto) {
    const folder = this.folder(auth.businessId, dto.purpose);
    const constraints = mediaConstraints(dto.purpose);
    return this.createSignature(folder, constraints.maxBytes, constraints.formats, constraints.resourceType, dto.purpose);
  }

  createPaymentProofUploadSignature(businessId: string, saleId: string) {
    const folder = this.folder(businessId, "PAYMENT_PROOF", saleId);
    return this.createSignature(folder, PAYMENT_PROOF_MAX_BYTES, IMAGE_FORMATS, "image", "PAYMENT_PROOF");
  }

  private createSignature(folder: string, maxBytes: number, formats: string[], resourceType: "image" | "video", purpose: MediaPurpose) {
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = randomBytes(12).toString("hex");
    const uploadParameters = this.providerUploadParameters(purpose, resourceType);
    const params: Record<string, string> = {
      allowed_formats: formats.join(","),
      folder,
      public_id: publicId,
      timestamp: String(timestamp),
      ...uploadParameters,
    };
    return {
      cloudName: this.config.getOrThrow<string>("CLOUDINARY_CLOUD_NAME"),
      apiKey: this.config.getOrThrow<string>("CLOUDINARY_API_KEY"),
      timestamp,
      folder,
      publicId,
      allowedFormats: formats,
      maxBytes,
      resourceType,
      uploadParameters,
      signature: this.sign(params),
    };
  }

  async register(auth: OwnerAuthContext, dto: RegisterMediaAssetDto) {
    const constraints = mediaConstraints(dto.purpose);
    return this.registerForBusiness(
      auth.businessId,
      auth.userId,
      dto,
      this.folder(auth.businessId, dto.purpose),
      dto.purpose,
      constraints.maxBytes,
    );
  }

  registerPaymentProofAsset(
    businessId: string,
    saleId: string,
    dto: RegisteredUpload,
  ) {
    return this.registerForBusiness(
      businessId,
      undefined,
      dto,
      this.folder(businessId, "PAYMENT_PROOF", saleId),
      "PAYMENT_PROOF",
      PAYMENT_PROOF_MAX_BYTES,
    );
  }

  private async registerForBusiness(
    businessId: string,
    uploadedById: string | undefined,
    dto: RegisteredUpload,
    expectedFolder: string,
    purpose: MediaPurpose,
    maxBytes: number,
  ) {
    const constraints = mediaConstraints(purpose);
    const format = dto.format.toLowerCase();
    if (!constraints.formats.includes(format)) {
      throw new BadRequestException(`Unsupported ${constraints.resourceType} format`);
    }
    if (dto.bytes > maxBytes) {
      throw new BadRequestException(`${constraints.resourceType === "video" ? "Video" : "Image"} exceeds the allowed size`);
    }
    if (!dto.publicId.startsWith(`${expectedFolder}/`)) {
      throw new BadRequestException("Upload does not belong to this business");
    }
    const url = new URL(dto.secureUrl);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com") {
      throw new BadRequestException("Invalid Cloudinary asset URL");
    }
    const expected = this.sign({
      public_id: dto.publicId,
      version: dto.version,
    });
    if (!safeEqual(expected, dto.signature)) {
      throw new BadRequestException("Cloudinary response signature is invalid");
    }
    const resourceType = dto.resourceType ?? constraints.resourceType;
    if (resourceType !== constraints.resourceType) {
      throw new BadRequestException("Cloudinary resource type does not match the upload purpose");
    }
    if (resourceType === "video" && (dto.durationSeconds ?? 0) > 30) {
      throw new BadRequestException("Video duration exceeds 30 seconds");
    }
    const providerAsset = await this.readProviderAssessment(dto.publicId, resourceType);
    if (providerAsset?.secureUrl && providerAsset.secureUrl !== dto.secureUrl) {
      throw new BadRequestException("Cloudinary asset URL does not match the verified upload");
    }
    const duplicate = dto.exactHash
      ? await this.prisma.mediaAsset.findFirst({
          where: {
            businessId,
            exactHash: dto.exactHash.toLowerCase(),
            status: "ACTIVE",
          },
          select: { id: true, publicId: true },
        })
      : null;
    const nearDuplicate = !duplicate && dto.perceptualHash
      ? (await this.prisma.mediaAsset.findMany({
          where: {
            businessId,
            perceptualHash: { not: null },
            status: "ACTIVE",
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, perceptualHash: true, publicId: true },
          take: 200,
        })).find((asset) => asset.perceptualHash
          && perceptualDistance(asset.perceptualHash, dto.perceptualHash!) <= 5) ?? null
      : null;
    const quality = assessQuality({
      width: dto.width,
      height: dto.height,
      client: dto.clientQualityMetrics,
      provider: providerAsset?.qualityAnalysis ?? dto.providerQualityAnalysis,
      duplicate,
      nearDuplicate,
    });
    const moderation = assessModeration({
      mode: this.moderationMode(),
      providerAvailable: Boolean(providerAsset?.moderation.length),
      providerModeration: providerAsset?.moderation,
    });
    return this.prisma.mediaAsset.create({
      data: {
        businessId,
        uploadedById,
        publicId: dto.publicId,
        secureUrl: dto.secureUrl,
        format,
        resourceType,
        mimeType: dto.mimeType,
        bytes: dto.bytes,
        width: dto.width,
        height: dto.height,
        durationSeconds: dto.durationSeconds,
        version: dto.version,
        originalFilename: dto.originalFilename,
        purpose,
        qualityStatus: quality.status,
        qualityMetrics: quality.metrics as Prisma.InputJsonValue,
        moderationStatus: moderation.status,
        contentRating: moderation.rating,
        moderationLabels: moderation.labels as Prisma.InputJsonValue,
        moderationProvider: moderation.provider,
        moderationModelVersion: moderation.version,
        exactHash: dto.exactHash?.toLowerCase(),
        perceptualHash: dto.perceptualHash?.toLowerCase(),
        assessedAt: new Date(),
      },
    });
  }

  list(auth: OwnerAuthContext) {
    return this.prisma.mediaAsset.findMany({
      where: { businessId: auth.businessId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
  }

  async appeal(auth: OwnerAuthContext, assetId: string, dto: AppealMediaAssetDto) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, businessId: auth.businessId, status: "ACTIVE" },
    });
    if (!asset) throw new NotFoundException("Asset not found");
    if (["AUTO_APPROVED", "MANUALLY_APPROVED"].includes(asset.moderationStatus) && asset.qualityStatus !== "FAIL") {
      throw new BadRequestException("Approved media does not need an appeal");
    }
    return this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        appealedAt: new Date(),
        appealReason: dto.reason.trim(),
        moderationStatus: "REVIEW_REQUIRED",
      },
    });
  }

  reviewQueue(cursor?: string) {
    return this.prisma.mediaAsset.findMany({
      where: {
        status: "ACTIVE",
        moderationStatus: { in: ["REVIEW_REQUIRED", "PENDING"] },
      },
      include: {
        business: { select: { id: true, name: true, slug: true } },
        uploadedBy: { select: { id: true, name: true, email: true } },
        moderationReviews: { orderBy: { createdAt: "desc" }, take: 3 },
      },
      orderBy: [{ appealedAt: "desc" }, { createdAt: "asc" }],
      take: 25,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  async handleCloudinaryNotification(
    rawBody: Buffer | undefined,
    timestamp: string | undefined,
    signature: string | undefined,
    payload: Record<string, unknown>,
  ) {
    const secret = this.config.get<string>("CLOUDINARY_API_SECRET");
    const eventSeconds = Number(timestamp);
    if (!secret || !rawBody || !timestamp || !signature || !Number.isFinite(eventSeconds)) {
      throw new UnauthorizedException("Cloudinary notification could not be verified");
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (eventSeconds < nowSeconds - 2 * 60 * 60 || eventSeconds > nowSeconds + 5 * 60) {
      throw new UnauthorizedException("Cloudinary notification timestamp is invalid");
    }
    const expected = createHash("sha1")
      .update(Buffer.concat([rawBody, Buffer.from(timestamp), Buffer.from(secret)]))
      .digest("hex");
    if (!safeEqual(expected, signature)) {
      throw new UnauthorizedException("Cloudinary notification signature is invalid");
    }

    const publicId = readString(payload.public_id);
    if (!publicId) return { matched: false };
    const asset = await this.prisma.mediaAsset.findUnique({ where: { publicId } });
    if (!asset || !isPublicCatalogPurpose(asset.purpose)) return { matched: false };

    const eventId = readString(payload.request_id)
      ?? createHash("sha256").update(rawBody).digest("hex");
    const eventAt = new Date(eventSeconds * 1000);
    if (
      asset.moderationEventId === eventId
      || (asset.moderationNotifiedAt && asset.moderationNotifiedAt >= eventAt)
    ) {
      return { assetId: asset.id, matched: true, repeated: true };
    }

    const moderationPayload = Array.isArray(payload.moderation)
      ? payload.moderation
      : Array.isArray(payload.moderations)
        ? payload.moderations
        : [];
    const moderation = assessModeration({
      mode: this.moderationMode(),
      providerAvailable: moderationPayload.length > 0,
      providerModeration: moderationPayload,
    });
    const updated = await this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: {
        contentRating: moderation.rating,
        moderationEventId: eventId,
        moderationLabels: moderation.labels as Prisma.InputJsonValue,
        moderationModelVersion: moderation.version,
        moderationNotifiedAt: eventAt,
        moderationProvider: moderation.provider,
        moderationStatus: moderation.status,
      },
    });
    if (
      !["AUTO_APPROVED", "MANUALLY_APPROVED"].includes(updated.moderationStatus)
      || updated.contentRating !== "GENERAL"
    ) {
      await this.prisma.product.updateMany({
        where: {
          OR: [
            { images: { some: { assetId: updated.id } } },
            {
              media: {
                some: {
                  OR: [
                    { assetId: updated.id },
                    { posterAssetId: updated.id },
                  ],
                },
              },
            },
          ],
        },
        data: { status: "DRAFT", visibility: "PRIVATE" },
      });
    }
    return { assetId: updated.id, matched: true, repeated: false };
  }

  async review(auth: PlatformAuthContext, assetId: string, dto: ReviewMediaAssetDto) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset || asset.status !== "ACTIVE") throw new NotFoundException("Asset not found");
    const next = reviewDecision(dto.decision);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.mediaAsset.update({
        where: { id: asset.id },
        data: {
          moderationStatus: next.status,
          contentRating: next.rating,
          qualityStatus: dto.decision === "REJECT" || asset.qualityStatus !== "FAIL" ? undefined : "WARN",
          appealReason: null,
        },
      });
      await tx.mediaModerationReview.create({
        data: {
          assetId: asset.id,
          reviewerId: auth.userId,
          decision: dto.decision,
          previousStatus: asset.moderationStatus,
          nextStatus: next.status,
          previousRating: asset.contentRating,
          nextRating: next.rating,
          reason: dto.reason.trim(),
        },
      });
      return updated;
    });
  }

  async remove(auth: OwnerAuthContext, assetId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, businessId: auth.businessId, status: "ACTIVE" },
      include: { productImages: true, productMedia: true, productPosters: true, showcaseImages: true, showcasePosters: true, logoFor: true, coverFor: true, avatarFor: true },
    });
    if (!asset) throw new NotFoundException("Asset not found");
    if (asset.productImages.length || asset.productMedia.length || asset.productPosters.length || asset.showcaseImages.length || asset.showcasePosters.length || asset.logoFor || asset.coverFor || asset.avatarFor) {
      throw new BadRequestException("Asset is still in use");
    }
    await this.destroyAtProvider(asset.publicId, asset.resourceType);
    return this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
  }

  private folder(businessId: string, purpose: string, suffix?: string) {
    const base = `loyal-loop/businesses/${businessId}/${purpose.toLowerCase()}`;
    return suffix ? `${base}/${suffix}` : base;
  }

  private sign(params: Record<string, string>) {
    const secret = this.config.getOrThrow<string>("CLOUDINARY_API_SECRET");
    const payload = Object.entries(params)
      .filter(([, value]) => value !== "")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");
    return createHash("sha1").update(`${payload}${secret}`).digest("hex");
  }

  private moderationMode(): "off" | "shadow" | "enforce" {
    const value = this.config.get<string>("MEDIA_MODERATION_MODE")?.toLowerCase();
    return value === "shadow" || value === "enforce" ? value : "off";
  }

  private providerUploadParameters(purpose: MediaPurpose, resourceType: "image" | "video") {
    if (!isPublicCatalogPurpose(purpose)) return {};
    const parameters: Record<string, string> = {};
    if (
      resourceType === "image" &&
      this.config.get<string>("MEDIA_QUALITY_ANALYSIS_ENABLED") === "true"
    ) {
      parameters.quality_analysis = "true";
    }
    const configuredProvider = this.config.get<string>(
      resourceType === "video" ? "MEDIA_VIDEO_MODERATION_PROVIDER" : "MEDIA_MODERATION_PROVIDER",
    )?.trim() || this.config.get<string>("MEDIA_MODERATION_PROVIDER")?.trim();
    const provider = resourceType === "video" && configuredProvider === "aws_rek"
      ? "aws_rek_video"
      : configuredProvider;
    if (this.moderationMode() !== "off" && provider) parameters.moderation = provider;
    const notificationUrl = this.config.get<string>("CLOUDINARY_NOTIFICATION_URL")?.trim();
    if (this.moderationMode() !== "off" && notificationUrl) {
      parameters.notification_url = notificationUrl;
    }
    return parameters;
  }

  private async readProviderAssessment(
    publicId: string,
    resourceType: string,
  ): Promise<ProviderAsset | null> {
    const wantsQuality = this.config.get<string>("MEDIA_QUALITY_ANALYSIS_ENABLED") === "true";
    if (!wantsQuality && this.moderationMode() === "off") return null;
    const cloudName = this.config.get<string>("CLOUDINARY_CLOUD_NAME");
    const apiKey = this.config.get<string>("CLOUDINARY_API_KEY");
    const apiSecret = this.config.get<string>("CLOUDINARY_API_SECRET");
    if (!cloudName || !apiKey || !apiSecret) return null;
    try {
      const query = new URLSearchParams({ quality_analysis: "true", moderations: "true" });
      const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/resources/${resourceType === "video" ? "video" : "image"}/upload/${encodeURIComponent(publicId)}?${query}`,
        {
          headers: {
            authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
          },
        },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as Record<string, unknown>;
      return {
        secureUrl: readString(data.secure_url),
        qualityAnalysis: readRecord(data.quality_analysis),
        moderation: Array.isArray(data.moderation)
          ? data.moderation
          : Array.isArray(data.moderations)
            ? data.moderations
            : [],
      };
    } catch {
      return null;
    }
  }

  private async destroyAtProvider(publicId: string, resourceType: string) {
    const cloudName = this.config.get<string>("CLOUDINARY_CLOUD_NAME");
    const apiKey = this.config.get<string>("CLOUDINARY_API_KEY");
    const apiSecret = this.config.get<string>("CLOUDINARY_API_SECRET");
    if (!cloudName || !apiKey || !apiSecret) {
      if (this.config.get("NODE_ENV") === "production") {
        throw new ServiceUnavailableException("Cloudinary is not configured");
      }
      return;
    }
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = this.sign({ public_id: publicId, timestamp });
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType === "video" ? "video" : "image"}/destroy`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          public_id: publicId,
          timestamp,
          api_key: apiKey,
          signature,
        }),
      },
    );
    if (!response.ok) {
      throw new ServiceUnavailableException("Cloudinary asset deletion failed");
    }
  }
}

type ProviderAsset = {
  secureUrl?: string;
  qualityAnalysis?: Record<string, unknown>;
  moderation: unknown[];
};

function assessQuality(input: {
  width?: number;
  height?: number;
  client?: Record<string, unknown>;
  provider?: Record<string, unknown>;
  duplicate: { id: string; publicId: string } | null;
  nearDuplicate: { id: string; publicId: string } | null;
}): { status: MediaQualityStatus; metrics: Record<string, unknown> } {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const focus = normalizedScore(input.provider?.focus ?? input.client?.focus);
  const darkRatio = readNumber(input.client?.darkRatio);
  const brightRatio = readNumber(input.client?.brightRatio);
  const minDimension = Math.min(input.width ?? Infinity, input.height ?? Infinity);
  const aspectRatio = input.width && input.height ? input.width / input.height : undefined;

  if (input.client?.corrupt === true) reasons.push("corrupt_file");
  if (minDimension < 320) reasons.push("resolution_too_low");
  else if (minDimension < 720) warnings.push("resolution_below_recommended");
  if (focus !== undefined && focus <= 0.1) reasons.push("severe_blur");
  else if (focus !== undefined && focus < 0.25) warnings.push("possible_blur");
  if (darkRatio !== undefined && darkRatio >= 0.92) reasons.push("severe_darkness");
  else if (darkRatio !== undefined && darkRatio > 0.72) warnings.push("image_is_dark");
  if (brightRatio !== undefined && brightRatio >= 0.92) reasons.push("severe_overexposure");
  else if (brightRatio !== undefined && brightRatio > 0.72) warnings.push("image_is_bright");
  if (aspectRatio !== undefined && (aspectRatio > 4 || aspectRatio < 0.25)) warnings.push("extreme_crop_or_aspect_ratio");
  if (input.duplicate) warnings.push("exact_duplicate");
  else if (input.nearDuplicate) warnings.push("near_duplicate");

  return {
    status: reasons.length ? "FAIL" : warnings.length ? "WARN" : "PASS",
    metrics: {
      client: input.client ?? null,
      provider: input.provider ?? null,
      reasons,
      warnings,
      duplicateAssetId: input.duplicate?.id ?? null,
      nearDuplicateAssetId: input.nearDuplicate?.id ?? null,
    },
  };
}

export function assessModeration(input: {
  mode: "off" | "shadow" | "enforce";
  providerAvailable: boolean;
  providerModeration?: unknown[];
}): {
  status: MediaModerationStatus;
  rating: MediaContentRating;
  labels: Record<string, unknown>;
  provider?: string;
  version?: string;
} {
  const parsed = parseModeration(input.providerModeration ?? []);
  const labels = {
    mode: input.mode,
    providerAvailable: input.providerAvailable,
    raw: input.providerModeration ?? [],
    recommendation: parsed.recommendation,
  };
  if (input.mode !== "enforce") {
    return {
      status: "AUTO_APPROVED",
      rating: "GENERAL",
      labels,
      provider: parsed.provider,
      version: parsed.version,
    };
  }
  if (!input.providerAvailable) {
    return { status: "REVIEW_REQUIRED", rating: "SENSITIVE_18", labels };
  }
  if (parsed.recommendation === "reject") {
    return {
      status: "REJECTED",
      rating: "PROHIBITED",
      labels,
      provider: parsed.provider,
      version: parsed.version,
    };
  }
  if (parsed.recommendation === "review") {
    return {
      status: "REVIEW_REQUIRED",
      rating: "SENSITIVE_18",
      labels,
      provider: parsed.provider,
      version: parsed.version,
    };
  }
  return {
    status: "AUTO_APPROVED",
    rating: "GENERAL",
    labels,
    provider: parsed.provider,
    version: parsed.version,
  };
}

function parseModeration(items: unknown[]) {
  const text = JSON.stringify(items).toLowerCase();
  const pending = /"status"\s*:\s*"(?:pending|queued|processing)"/.test(text);
  const rejected = /"status"\s*:\s*"rejected"/.test(text);
  const explicit = /(porn|"explicit"|explicit nudity|explicit sexual activity|graphic sexual|child sexual)/.test(text);
  const sensitive = /(nudity|suggestive|adult|sexual|lingerie|swimwear|weapon|firearm|\bgun\b|pistol|rifle|shooting|graphic violence|gore|blood|drugs?\s*&\s*tobacco|drug products?|drug paraphernalia|controlled substance|illegal drug|\bpills?\b|smoking|tobacco|alcohol|gambling|hate symbols?|rude gestures?)/.test(text);
  return {
    recommendation: rejected || explicit ? "reject" : pending || sensitive ? "review" : "approve",
    provider: findNestedString(items, ["kind", "provider"]),
    version: findNestedString(items, ["version", "model_version"]),
  } as const;
}

function reviewDecision(decision: MediaReviewDecision): {
  status: MediaModerationStatus;
  rating: MediaContentRating;
} {
  if (decision === "REJECT") return { status: "REJECTED", rating: "PROHIBITED" };
  if (decision === "APPROVE_SENSITIVE") {
    return { status: "MANUALLY_APPROVED", rating: "SENSITIVE_18" };
  }
  return { status: "MANUALLY_APPROVED", rating: "GENERAL" };
}

function isPublicCatalogPurpose(purpose: MediaPurpose) {
  return [
    "PRODUCT_IMAGE",
    "PRODUCT_VIDEO",
    "PRODUCT_VIDEO_POSTER",
    "SHOWCASE_IMAGE",
    "SHOWCASE_VIDEO",
    "SHOWCASE_VIDEO_POSTER",
  ].includes(purpose);
}

function readNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizedScore(value: unknown) {
  const number = readNumber(value);
  if (number === undefined) return undefined;
  return number > 1 ? number / 100 : number;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function findNestedString(value: unknown, keys: string[]): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const result = findNestedString(entry, keys);
      if (result) return result;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string") return record[key];
  }
  for (const entry of Object.values(record)) {
    const result = findNestedString(entry, keys);
    if (result) return result;
  }
  return undefined;
}

function mediaConstraints(purpose: MediaPurpose) {
  if (purpose === "PRODUCT_VIDEO" || purpose === "SHOWCASE_VIDEO") {
    return { formats: VIDEO_FORMATS, maxBytes: 50 * 1024 * 1024, resourceType: "video" as const };
  }
  if (purpose === "PAYMENT_PROOF") {
    return { formats: IMAGE_FORMATS, maxBytes: PAYMENT_PROOF_MAX_BYTES, resourceType: "image" as const };
  }
  return { formats: IMAGE_FORMATS, maxBytes: 10 * 1024 * 1024, resourceType: "image" as const };
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function perceptualDistance(left: string, right: string) {
  try {
    let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
    let distance = 0;
    while (value) {
      distance += Number(value & 1n);
      value >>= 1n;
    }
    return distance;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
