import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../../common/pagination.dto";
import { ProductMediaKind, ShowcaseStatus } from "../../../generated/prisma/client";

export class ExploreDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  cursor?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  query?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;

  @IsOptional()
  @IsIn(["for-you", "products", "showcases"])
  mode?: "for-you" | "products" | "showcases";

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  color?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  size?: string;
}

export class ParseDiscoveryQueryDto {
  @IsString()
  @Length(1, 120)
  query!: string;
}

export class DiscoveryPreferenceDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  preferences!: string[];
}

export class DiscoveryEventDto {
  @IsIn([
    "PRODUCT_IMPRESSION",
    "PRODUCT_VIEWED",
    "PRODUCT_SAVED",
    "PRODUCT_SHARED",
    "SHOWCASE_IMPRESSION",
    "SHOWCASE_VIEWED",
    "SHOWCASE_SAVED",
    "SHOWCASE_SHARED",
    "SHOP_IMPRESSION",
    "SHOP_VIEWED",
  ])
  type!: "PRODUCT_IMPRESSION" | "PRODUCT_VIEWED" | "PRODUCT_SAVED" | "PRODUCT_SHARED" | "SHOWCASE_IMPRESSION" | "SHOWCASE_VIEWED" | "SHOWCASE_SAVED" | "SHOWCASE_SHARED" | "SHOP_IMPRESSION" | "SHOP_VIEWED";

  @IsOptional()
  @IsString()
  businessId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  showcaseId?: string;

  @IsOptional()
  @IsString()
  @Length(8, 120)
  sessionKey?: string;

  @IsOptional()
  @IsString()
  @Length(8, 160)
  dedupeKey?: string;

  @IsOptional()
  @IsIn(["explore", "explore_recent", "explore_recommendation", "explore_search"])
  surface?: "explore" | "explore_recent" | "explore_recommendation" | "explore_search";

  @IsOptional()
  @IsString()
  @Length(1, 120)
  searchQuery?: string;

  @IsOptional()
  @IsString()
  @Length(1, 140)
  filter?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(500)
  position?: number;

  @IsOptional()
  @IsString()
  @Length(40, 512)
  impressionToken?: string;
}

export class ShowcaseHotspotDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  x!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  y!: number;
}

export class CreateShowcaseDto {
  @IsString()
  assetId!: string;

  @IsOptional()
  @IsString()
  posterAssetId?: string;

  @IsOptional()
  @IsEnum(ProductMediaKind)
  mediaKind?: ProductMediaKind;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(30)
  durationSeconds?: number;

  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  caption?: string;

  @IsOptional()
  @IsEnum(ShowcaseStatus)
  status?: ShowcaseStatus;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ShowcaseHotspotDto)
  hotspots!: ShowcaseHotspotDto[];
}

export class UpdateShowcaseDto {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  posterAssetId?: string;

  @IsOptional()
  @IsEnum(ProductMediaKind)
  mediaKind?: ProductMediaKind;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(30)
  durationSeconds?: number;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  caption?: string;

  @IsOptional()
  @IsEnum(ShowcaseStatus)
  status?: ShowcaseStatus;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ShowcaseHotspotDto)
  hotspots?: ShowcaseHotspotDto[];
}
