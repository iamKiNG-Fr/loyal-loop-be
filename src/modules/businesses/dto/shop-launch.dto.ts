import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from "class-validator";
import { LaunchTemplate } from "../../../generated/prisma/client";

export class ScheduleShopLaunchDto {
  @IsDateString()
  launchAt!: string;

  @IsString()
  @Length(1, 80)
  timezone!: string;

  @IsEnum(LaunchTemplate)
  template!: LaunchTemplate;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  message?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsBoolean()
  autoOpen?: boolean;
}

export class OpenShopDto {
  @IsOptional()
  @IsBoolean()
  confirmEmpty?: boolean;
}
