import { Transform } from "class-transformer";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class CreateWaitlistEntryDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(2)
  name!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(2)
  businessName!: string;

  @Transform(({ value }) => trimString(value))
  @IsEmail()
  email!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  refCode?: string;
}

function trimString(value: unknown) {
  return typeof value === "string" ? value.trim() : value;
}
