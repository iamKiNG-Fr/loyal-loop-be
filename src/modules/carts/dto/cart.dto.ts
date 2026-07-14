import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from "class-validator";
import { FulfillmentType, PaymentMethod } from "../../../generated/prisma/client";

export class AddCartItemDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity = 1;
}

export class UpdateCartItemDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  quantity!: number;
}

export class UpdateCartGroupDto {
  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillment?: FulfillmentType;

  @IsOptional()
  @IsString()
  customerAddressId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentPreference?: PaymentMethod;
}

export class MergeDeviceCartDto {
  @IsString()
  @Length(16, 120)
  deviceKey!: string;
}

export class SubmitCartDto {
  @IsString()
  @Length(12, 120)
  idempotencyKey!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  businessIds?: string[];

  @IsOptional()
  @IsBoolean()
  confirmedChanges?: boolean;
}
