import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from "class-validator";
import { DeliveryStatus } from "../../../generated/prisma/client";

export class UpdateDeliveryDto {
  @IsEnum(DeliveryStatus)
  status!: DeliveryStatus;

  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  trackingUrl?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  trackingCode?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  courier?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  address?: string;

  @IsOptional()
  @IsString()
  @Length(1, 240)
  googlePlaceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;
}

export class SubmitDeliveryFeedbackDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  comment?: string;
}

export class CreateDeliveryIssueDto {
  @IsString()
  @Length(3, 1000)
  description!: string;
}
