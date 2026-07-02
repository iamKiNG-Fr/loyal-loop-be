import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import {
  FulfillmentType,
  PaymentStatus,
  PaymentEntryType,
  SalesChannel,
} from "../../../generated/prisma/client";
import { PaginationDto } from "../../../common/pagination.dto";

export class CreateSaleItemDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsString()
  @Length(1, 160)
  name!: string;

  @IsOptional()
  @IsUrl({ protocols: ["https"], require_protocol: true })
  imageUrl?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  quantity!: number;

  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  unitPrice!: string;

  @IsOptional()
  @IsString()
  @Length(3, 240)
  priceAdjustmentReason?: string;
}

export class CreateSaleDto {
  @IsString()
  customerId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items!: CreateSaleItemDto[];

  @IsOptional()
  @IsEnum(SalesChannel)
  channel?: SalesChannel;

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillment?: FulfillmentType;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  discount?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  deliveryFee?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  amountPaid?: string;

  @IsOptional()
  @IsBoolean()
  protectedPayment?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;

  @IsOptional()
  @IsString()
  sourceRequestId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  receiptNote?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
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
  @IsBoolean()
  isGift?: boolean;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  recipientName?: string;

  @IsOptional()
  @IsString()
  @Length(5, 30)
  recipientPhone?: string;
}

export class RecordPaymentDto {
  @IsEnum(PaymentEntryType)
  type!: PaymentEntryType;

  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  amount!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  reference?: string;
}

export class SaleListDto extends PaginationDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  query?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsEnum(SalesChannel)
  channel?: SalesChannel;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
