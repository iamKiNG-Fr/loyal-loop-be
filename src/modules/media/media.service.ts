import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { OwnerAuthContext } from "../../common/request-context";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateUploadSignatureDto,
  RegisterMediaAssetDto,
} from "./dto/media.dto";

const ALLOWED_FORMATS = new Set(["jpg", "jpeg", "png", "webp"]);

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  createUploadSignature(auth: OwnerAuthContext, dto: CreateUploadSignatureDto) {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = this.folder(auth.businessId, dto.purpose);
    const publicId = randomBytes(12).toString("hex");
    const params = {
      allowed_formats: "jpg,jpeg,png,webp",
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
      allowedFormats: [...ALLOWED_FORMATS],
      maxBytes: 10 * 1024 * 1024,
      signature: this.sign(params),
    };
  }

  async register(auth: OwnerAuthContext, dto: RegisterMediaAssetDto) {
    const format = dto.format.toLowerCase();
    if (!ALLOWED_FORMATS.has(format)) {
      throw new BadRequestException("Unsupported image format");
    }
    const expectedFolder = this.folder(auth.businessId, dto.purpose);
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
    return this.prisma.mediaAsset.create({
      data: {
        businessId: auth.businessId,
        uploadedById: auth.userId,
        publicId: dto.publicId,
        secureUrl: dto.secureUrl,
        format,
        bytes: dto.bytes,
        width: dto.width,
        height: dto.height,
        version: dto.version,
        originalFilename: dto.originalFilename,
        purpose: dto.purpose,
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
      include: { productImages: true, logoFor: true },
    });
    if (!asset) throw new NotFoundException("Asset not found");
    if (asset.productImages.length || asset.logoFor) {
      throw new BadRequestException("Asset is still in use");
    }
    await this.destroyAtProvider(asset.publicId);
    return this.prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "DELETED", deletedAt: new Date() },
    });
  }

  private folder(businessId: string, purpose: string) {
    return `loyal-loop/businesses/${businessId}/${purpose.toLowerCase()}`;
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

  private async destroyAtProvider(publicId: string) {
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
      `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
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

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
