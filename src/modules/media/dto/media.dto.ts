import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from "class-validator";
import { MediaPurpose } from "../../../generated/prisma/client";

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
}
