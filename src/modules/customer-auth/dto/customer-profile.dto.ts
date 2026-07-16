import {
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from "class-validator";

export class UpdateCustomerProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  alternatePhone?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== "")
  @IsDateString()
  birthday?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  gender?: string;

  @IsOptional()
  @IsObject()
  socials?: Record<string, string>;
}
