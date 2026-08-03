import { Transform } from "class-transformer";
import {
  IsEnum,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";
import {
  CustomerReportStatus,
  PlatformAdminStatus,
  PlatformRole,
} from "../../../generated/prisma/client";

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
  @Matches(/^[A-Z][A-Z_]{1,39}$/)
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

export class ApproveFoundingApplicationDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  cohortId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  expiresInDays?: number;

  @IsOptional()
  @IsBoolean()
  sendWhatsapp?: boolean;
}

export class ReplaceInvitationDto {
  @IsOptional()
  @IsBoolean()
  sendWhatsapp?: boolean;
}

export class GrantPlatformAdminDto {
  @Transform(trim)
  @IsString()
  @Length(3, 254)
  email!: string;

  @IsEnum(PlatformRole)
  role!: PlatformRole;
}

export class UpdatePlatformAdminDto {
  @IsOptional()
  @IsEnum(PlatformRole)
  role?: PlatformRole;

  @IsOptional()
  @IsEnum(PlatformAdminStatus)
  status?: PlatformAdminStatus;

  @Transform(trim)
  @IsString()
  @Length(4, 500)
  reason!: string;

  @Transform(trim)
  @IsString()
  @Length(3, 254)
  confirmation!: string;
}

export class ReviewPlatformAdminDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(4, 500)
  notes?: string;
}

export class RevokePlatformSessionDto {
  @Transform(trim)
  @IsString()
  @Length(4, 500)
  reason!: string;
}
