import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import {
  FulfillmentType,
  OrderRequestStatus,
  ProductInterestType,
  SalesChannel,
} from "../../../generated/prisma/client";

export class PublicRequestItemDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;
}

export class CreateOrderRequestDto {
  @IsString()
  @Length(1, 120)
  customerName!: string;

  @IsString()
  @Length(5, 30)
  customerPhone!: string;

  @IsEnum(SalesChannel)
  channel!: SalesChannel;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillment?: FulfillmentType;

  @IsOptional()
  @IsString()
  customerAddressId?: string;

  @IsOptional()
  @IsString()
  @Length(5, 500)
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  @Length(1, 240)
  deliveryPlaceId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  deliveryLatitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  deliveryLongitude?: number;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  deliveryNotes?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PublicRequestItemDto)
  items!: PublicRequestItemDto[];
}

export class UpdateOrderRequestStatusDto {
  @IsEnum(OrderRequestStatus)
  status!: OrderRequestStatus;
}

export class WishlistProductDto {
  @IsString()
  productId!: string;
}

export class ProductInterestDto {
  @IsString()
  productId!: string;

  @IsEnum(ProductInterestType)
  type!: ProductInterestType;
}
