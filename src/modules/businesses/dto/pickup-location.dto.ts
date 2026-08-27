import { Type } from "class-transformer";
import { IsBoolean, IsNumber, IsOptional, IsString, Length, Max, Min } from "class-validator";

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
  @IsBoolean()
  isDefault?: boolean;
}
