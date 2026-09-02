import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateNested,
} from "class-validator";
import { StorefrontStoryKind } from "../../../generated/prisma/client";

export class StorefrontStoryDto {
  @IsEnum(StorefrontStoryKind)
  kind!: StorefrontStoryKind;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  collectionId?: string;

  @IsOptional()
  @IsString()
  showcaseId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  caption?: string;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ["http", "https"] })
  @Length(8, 500)
  linkUrl?: string;
}

export class ReplaceStorefrontStoriesDto {
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => StorefrontStoryDto)
  stories!: StorefrontStoryDto[];
}
