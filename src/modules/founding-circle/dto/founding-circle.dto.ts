import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateFoundingApplicationDto {
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  ownerName!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  businessName!: string;

  @Transform(trim)
  @IsEmail()
  email!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 160)
  whatTheySell!: string;

  @Transform(trim)
  @IsString()
  @IsIn(["WHATSAPP", "INSTAGRAM", "FACEBOOK", "TIKTOK", "WALK_IN", "OTHER"])
  primarySellingChannel!: string;

  @IsBoolean()
  whatsappConsent!: boolean;
}

export class ValidateFoundingAccessDto {
  @Transform(trim)
  @IsString()
  @Length(8, 40)
  code!: string;
}

export class CreateFoundingCohortDto {
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @Length(2, 80)
  key!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  hypothesis?: string;
}

export class CreateFoundingInvitationDto {
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  recipientName!: string;

  @Transform(trim)
  @IsString()
  @Length(2, 120)
  businessName!: string;

  @Transform(trim)
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone!: string;

  @Transform(trim)
  @IsOptional()
  @IsEmail()
  email?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  cohortId?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  applicationId?: string;

  @IsBoolean()
  consentAttested!: boolean;

  @IsOptional()
  @IsBoolean()
  sendWhatsapp?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  expiresInDays?: number;
}

export class ReviewFoundingApplicationDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;
}

export class CompleteLegacyFoundingApplicationDto {
  @Transform(trim)
  @Matches(/^\+?[1-9]\d{7,14}$/)
  phone!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(2, 160)
  whatTheySell?: string;

  @Transform(trim)
  @IsOptional()
  @IsIn(["WHATSAPP", "INSTAGRAM", "FACEBOOK", "TIKTOK", "WALK_IN", "OTHER"])
  primarySellingChannel?: string;

  @IsBoolean()
  consentAttested!: boolean;
}

export class RevokeInvitationDto {
  @Transform(trim)
  @IsString()
  @Length(4, 500)
  reason!: string;
}

export class CreateResearchInterviewDto {
  @Transform(trim)
  @IsString()
  @Length(2, 80)
  stage!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  mostValuableOutcome?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  primaryBlocker?: string;

  @IsOptional()
  @IsIn(["NOT_ASKED", "YES", "MAYBE", "NO"])
  paidPilotInterest?: "NOT_ASKED" | "YES" | "MAYBE" | "NO";

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reasonToPayOrNot?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  volunteeredPriceAmount?: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(3, 3)
  volunteeredPriceCurrency?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}
