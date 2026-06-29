import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import {
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
