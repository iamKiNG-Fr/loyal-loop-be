import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import {
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
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @IsEnum(ProductPlacement)
  placement?: ProductPlacement;

  @IsOptional()
  @IsEnum(ProductVisibility)
  visibility?: ProductVisibility;

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

export class ProductListDto extends PaginationDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
