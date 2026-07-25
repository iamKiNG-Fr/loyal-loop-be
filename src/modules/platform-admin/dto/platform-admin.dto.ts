import { Transform } from "class-transformer";
import {
  IsEnum,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";
import { CustomerReportStatus } from "../../../generated/prisma/client";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class AdminListQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 120)
  search?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  includeDemo?: boolean;
}

export class SuspendBusinessDto {
  @Transform(trim)
  @IsString()
  @Length(4, 500)
  reason!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  confirmation!: string;
}

export class ReactivateBusinessDto {
  @Transform(trim)
  @IsString()
  @Length(4, 500)
  reason!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  confirmation!: string;
}

export class ReviewCustomerReportDto {
  @IsEnum(CustomerReportStatus)
  status!: CustomerReportStatus;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(3, 1200)
  notes?: string;
}
