import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
} from "class-validator";

const ATTENTION_KEY_PATTERN = /^(issue|order|payment|delivery|follow-up|low-stock|inventory|activity):[A-Za-z0-9._:-]+$/;

export class MarkAttentionSeenDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 180, { each: true })
  @Matches(ATTENTION_KEY_PATTERN, { each: true })
  keys!: string[];
}

export class SnoozeAttentionDto {
  @IsString()
  @Length(1, 180)
  @Matches(ATTENTION_KEY_PATTERN)
  key!: string;

  @IsISO8601()
  until!: string;
}

export class UpdateOwnerNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  followUpNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  receiptViewNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  deliveryNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappDigestEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappConsentAccepted?: boolean;

  @IsOptional()
  @IsBoolean()
  customerMemoryWhatsappEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  customerMemoryConsentAccepted?: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  digestTime?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @IsIn([0, 1, 2, 3, 4, 5, 6], { each: true })
  weekdays?: number[];

  @IsOptional()
  @IsBoolean()
  paused?: boolean;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20])
  lowStockThreshold?: number;
}

export class SavePushSubscriptionDto {
  @IsUrl({ require_protocol: true, protocols: ["https"] })
  endpoint!: string;

  @IsString()
  @Length(20, 512)
  p256dh!: string;

  @IsString()
  @Length(8, 256)
  auth!: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

export class RemovePushSubscriptionDto {
  @IsUrl({ require_protocol: true, protocols: ["https"] })
  endpoint!: string;
}
