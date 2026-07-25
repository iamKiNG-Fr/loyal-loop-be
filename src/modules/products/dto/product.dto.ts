import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsObject,
  IsBoolean,
  ValidateNested,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import {
  ProductMediaKind,
  ProductPlacement,
  ProductStatus,
  ProductVisibility,
} from "../../../generated/prisma/client";
import { PaginationDto } from "../../../common/pagination.dto";

export class CreateProductDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  price!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  category?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string | number | boolean>;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(ProductPlacement)
  placement?: ProductPlacement;

  @IsOptional()
  @IsEnum(ProductVisibility)
  visibility?: ProductVisibility;

  @IsOptional()
  @IsIn(["GENERAL", "SENSITIVE_18"])
  contentRating?: "GENERAL" | "SENSITIVE_18";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stockCount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  imageAssetIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInputDto)
  variants?: ProductVariantInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProductMediaInputDto)
  media?: ProductMediaInputDto[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  price?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  category?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string | number | boolean>;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInputDto)
  variants?: ProductVariantInputDto[];

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(ProductPlacement)
  placement?: ProductPlacement;

  @IsOptional()
  @IsEnum(ProductVisibility)
  visibility?: ProductVisibility;

  @IsOptional()
  @IsIn(["GENERAL", "SENSITIVE_18"])
  contentRating?: "GENERAL" | "SENSITIVE_18";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stockCount?: number;
}

export class ReplaceProductImagesDto {
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  assetIds!: string[];
}

export class ProductVariantInputDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsObject()
  optionValues!: Record<string, string>;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  priceOverride?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  sku?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stockCount?: number;
}

export class ProductMediaInputDto {
  @IsString()
  assetId!: string;

  @IsOptional()
  @IsString()
  posterAssetId?: string;

  @IsEnum(ProductMediaKind)
  kind!: ProductMediaKind;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  altText?: string;
}

export class ReplaceProductMediaDto {
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => ProductMediaInputDto)
  media!: ProductMediaInputDto[];
}

export class ProductListDto extends PaginationDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}

export class SuggestProductDescriptionDto {
  @IsString()
  @Length(1, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  category?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  currentDescription?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, string | number | boolean>;
}

export class SuggestProductFormGuidanceDto {
  @IsOptional()
  @IsString()
  @Length(0, 160)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  category?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  currentDescription?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{0,10}(?:\.\d{1,2})?$/)
  price?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{0,7}$/)
  stock?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(8)
  mediaCount!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  optionCount!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  optionNames?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  availableCategories?: string[];

  @IsOptional()
  @IsIn(["GENERAL", "SENSITIVE_18"])
  contentRating?: "GENERAL" | "SENSITIVE_18";

  @IsOptional()
  @IsString()
  @Length(0, 80)
  placement?: string;
}

export class SuggestShowcaseCaptionDto {
  @IsString()
  @Length(1, 120)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  currentCaption?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  productNames?: string[];
}
