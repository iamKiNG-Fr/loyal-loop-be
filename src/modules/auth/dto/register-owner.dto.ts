import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from "class-validator";
import { BusinessTheme, ContactPlatform, PaymentMethod } from "../../../generated/prisma/client";

export class RegisterBusinessContactDto {
  @IsEnum(ContactPlatform)
  platform!: ContactPlatform;

  @IsString()
  @Length(1, 240)
  value!: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class RegisterOwnerDto {
  @IsString()
  @Length(2, 100)
  ownerName!: string;

  @IsEmail()
  @Length(3, 254)
  email!: string;

  @IsString()
  @MinLength(8)
  @Length(8, 128)
  password!: string;

  @IsString()
  @IsNotEmpty({ message: "Verify your WhatsApp number before creating the business" })
  @Length(1, 120, { message: "Verify your WhatsApp number before creating the business" })
  phoneVerificationChallengeId!: string;

  @IsString()
  @Length(2, 120)
  businessName!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @Length(2, 80)
  slug!: string;

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
  @Length(1, 160)
  location?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  pledgeSignature?: string;

  @IsOptional()
  @IsEnum(BusinessTheme)
  theme?: BusinessTheme;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => RegisterBusinessContactDto)
  contacts?: RegisterBusinessContactDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsEnum(PaymentMethod, { each: true })
  allowedPaymentMethods?: PaymentMethod[];

  @IsOptional()
  @IsEnum(PaymentMethod)
  defaultPaymentMethod?: PaymentMethod;
}

export class CheckOnboardingAvailabilityDto {
  @IsOptional()
  @IsEmail()
  email?: string;
}
