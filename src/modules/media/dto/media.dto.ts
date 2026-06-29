import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from "class-validator";
import { MediaPurpose } from "../../../generated/prisma/client";

export class CreateUploadSignatureDto {
  @IsEnum(MediaPurpose)
  purpose!: MediaPurpose;
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
  @Max(10 * 1024 * 1024)
  bytes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

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
