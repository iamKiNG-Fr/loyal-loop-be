import { Type } from "class-transformer";
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";

export class CreateCustomerAddressDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  label?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @Length(5, 30)
  phone?: string;

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
  @Length(0, 500)
  deliveryNotes?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateCustomerAddressDto extends CreateCustomerAddressDto {
  @IsOptional()
  @IsString()
  @Length(5, 500)
  declare address: string;
}
