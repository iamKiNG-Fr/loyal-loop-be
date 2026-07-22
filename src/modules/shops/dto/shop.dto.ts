import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { DISCOVERY_CAMPAIGNS, DISCOVERY_SOURCES } from "../discovery-attribution";
import {
  FulfillmentType,
  OrderRequestStatus,
  PaymentMethod,
  ProductInterestType,
  SalesChannel,
} from "../../../generated/prisma/client";

export class DiscoveryAttributionDto {
  @IsOptional()
  @IsIn(DISCOVERY_SOURCES)
  utm_source?: string;

  @IsOptional()
  @IsIn(["social"])
  utm_medium?: string;

  @IsOptional()
  @IsIn(DISCOVERY_CAMPAIGNS)
  utm_campaign?: string;
}

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
  @IsOptional()
  @IsString()
  sourceShowcaseId?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  requestedPaymentMethod?: PaymentMethod;

  @IsString()
  @Length(1, 120)
  customerName!: string;

  @IsString()
  @Length(5, 30)
  customerPhone!: string;

  @IsOptional()
  @IsBoolean()
  whatsappUpdatesConsent?: boolean;

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
  @Length(2, 2)
  deliveryCountryCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  deliveryAdministrativeArea1?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  deliveryLocality?: string;

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

export class ChangeRequestedPaymentMethodDto {
  @IsEnum(PaymentMethod)
  paymentMethod!: PaymentMethod;
}

export class RequestOrderTermsChangeDto {
  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillment?: FulfillmentType;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsString()
  @Length(3, 300)
  reason!: string;
}

export class RespondOrderTermsChangeDto {
  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillment?: FulfillmentType;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;
}

export class UpdateOrderRequestStatusDto {
  @IsEnum(OrderRequestStatus)
  status!: OrderRequestStatus;

  @IsOptional()
  @IsIn(["NO_STOCK", "OUTSIDE_DELIVERY_AREA", "CANNOT_FULFILL", "STORE_CLOSED", "OTHER"])
  cancellationReasonCode?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  cancellationReason?: string;
}

export class ConfirmOrderRequestDto {
  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillment?: FulfillmentType;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  deliveryFee?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  amountPaid?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentMethod;

  @IsOptional()
  @IsString()
  paymentAccountId?: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  paymentBankName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  paymentAccountName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6,20}$/)
  paymentAccountNumber?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  paymentInstructions?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
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
