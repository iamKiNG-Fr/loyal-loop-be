import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from "class-validator";
import {
  BusinessTheme,
  ContactPlatform,
  ExportAccess,
  NumberFormat,
  PaymentStatus,
  ReceiptDeliveryLine,
  RetentionPolicy,
  StoreStatus,
} from "../../../generated/prisma/client";

export class UpdateBusinessDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @Length(2, 80)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  category?: string;

  @IsOptional()
  @IsString()
  @Length(1, 160)
  categoryDetail?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 160)
  location?: string;

  @IsOptional()
  @IsEnum(StoreStatus)
  storeStatus?: StoreStatus;

  @IsOptional()
  @IsString()
  logoAssetId?: string;
}

export class BusinessContactDto {
  @IsEnum(ContactPlatform)
  platform!: ContactPlatform;

  @IsString()
  @Length(1, 240)
  value!: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  label?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class ReplaceBusinessContactsDto {
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => BusinessContactDto)
  contacts!: BusinessContactDto[];
}

export class OwnerPledgeDto {
  @IsString()
  @Length(2, 100)
  signature!: string;
}

export class UpdateBusinessPreferencesDto {
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  @IsOptional()
  @IsEnum(NumberFormat)
  numberFormat?: NumberFormat;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  timezone?: string;

  @IsOptional()
  @IsEnum(BusinessTheme)
  theme?: BusinessTheme;

  @IsOptional()
  @IsEnum(PaymentStatus)
  defaultPaymentStatus?: PaymentStatus;

  @IsOptional()
  @IsBoolean()
  protectedPaymentEnabled?: boolean;

  @IsOptional()
  @IsEnum(ReceiptDeliveryLine)
  receiptDeliveryLine?: ReceiptDeliveryLine;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  receiptFooter?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  feedbackResponseTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(carousel|grid)$/)
  shelfMode?: string;

  @IsOptional()
  @IsBoolean()
  showRecommended?: boolean;

  @IsOptional()
  @IsBoolean()
  showLatest?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @Length(1, 50, { each: true })
  tickerItems?: string[];

  @IsOptional()
  @IsBoolean()
  notifyFollowUps?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyReceiptViews?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyDeliveryUpdates?: boolean;

  @IsOptional()
  @IsEnum(ExportAccess)
  exportAccess?: ExportAccess;

  @IsOptional()
  @IsEnum(RetentionPolicy)
  retentionPolicy?: RetentionPolicy;
}
