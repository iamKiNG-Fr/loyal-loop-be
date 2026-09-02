import { Type } from "class-transformer";
import { IsBoolean, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";

export class SavePickupLocationDto {
  @IsString()
  @Length(1, 80)
  label!: string;

  @IsString()
  @Length(5, 500)
  address!: string;

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

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z]{2}$/)
  countryCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  regionCode?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
