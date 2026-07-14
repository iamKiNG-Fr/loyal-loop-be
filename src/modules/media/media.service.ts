import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OwnerAuthContext } from "../../common/request-context";
import type { MediaPurpose } from "../../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateUploadSignatureDto,
  MediaFailureTelemetryDto,
  RegisterMediaAssetDto,
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
    return this.createSignature(folder, constraints.maxBytes, constraints.formats, constraints.resourceType);
  }

  createPaymentProofUploadSignature(businessId: string, saleId: string) {
    const folder = this.folder(businessId, "PAYMENT_PROOF", saleId);
    return this.createSignature(folder, PAYMENT_PROOF_MAX_BYTES, IMAGE_FORMATS, "image");
  }

  private createSignature(folder: string, maxBytes: number, formats: string[], resourceType: "image" | "video") {
    const timestamp = Math.floor(Date.now() / 1000);
    const publicId = randomBytes(12).toString("hex");
    const params = {
      allowed_formats: formats.join(","),
      folder,
      public_id: publicId,
      timestamp: String(timestamp),
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
      },
    });
  }

  list(auth: OwnerAuthContext) {
    return this.prisma.mediaAsset.findMany({
      where: { businessId: auth.businessId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
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
