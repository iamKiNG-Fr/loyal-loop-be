import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MinLength,
  ValidateNested,
} from "class-validator";
import { BusinessTheme, ContactPlatform } from "../../../generated/prisma/client";

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
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

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
}
