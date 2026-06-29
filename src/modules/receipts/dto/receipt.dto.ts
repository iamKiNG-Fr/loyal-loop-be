import { IsEnum, IsOptional, IsString, Length } from "class-validator";
import { ReceiptTheme } from "../../../generated/prisma/client";

export class UpdateReceiptDto {
  @IsOptional()
  @IsEnum(ReceiptTheme)
  theme?: ReceiptTheme;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class CreateReceiptIssueDto {
  @IsString()
  @Length(3, 1000)
  description!: string;
}
