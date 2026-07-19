import {
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import {
  MediaPurpose,
  MediaReviewDecision,
} from "../../../generated/prisma/client";

export class CreateUploadSignatureDto {
  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;
}

export class MediaFailureTelemetryDto {
  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;

  @IsIn(["signature", "upload", "registration", "validation"])
  phase!: "signature" | "upload" | "registration" | "validation";

  @IsString()
  @Length(1, 300)
  message!: string;
}

export class RegisterMediaAssetDto {
  @IsString()
  publicId!: string;

  @IsUrl({ protocols: ["https"], require_protocol: true })
  secureUrl!: string;

  @IsString()
  format!: string;

  @IsInt()
  @Min(1)
  @Max(50 * 1024 * 1024)
  bytes!: number;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @IsOptional()
  @Min(0)
  @Max(30)
  durationSeconds?: number;

  @IsString()
  version!: string;

  @IsString()
  signature!: string;

  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;

  @IsOptional()
  @IsString()
  originalFilename?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{64}$/i)
  exactHash?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-f0-9]{16}$/i)
  perceptualHash?: string;

  @IsOptional()
  @IsObject()
  clientQualityMetrics?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  providerQualityAnalysis?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  providerModeration?: unknown[];
}

export class AppealMediaAssetDto {
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class ReviewMediaAssetDto {
  @IsEnum(MediaReviewDecision)
  decision!: MediaReviewDecision;

  @IsString()
  @Length(5, 500)
  reason!: string;
}
