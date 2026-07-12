import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { PaginationDto } from "../../../common/pagination.dto";
import { ShowcaseStatus } from "../../../generated/prisma/client";

export class ExploreDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  query?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;
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
