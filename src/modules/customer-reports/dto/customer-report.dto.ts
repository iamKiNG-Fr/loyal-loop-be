import { Transform } from "class-transformer";
import { IsEnum, IsOptional, IsString, Length } from "class-validator";
import {
  CustomerReportReason,
  CustomerReportSubjectType,
} from "../../../generated/prisma/client";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class CreateCustomerReportDto {
  @IsEnum(CustomerReportSubjectType)
  subjectType!: CustomerReportSubjectType;

  @Transform(trim)
  @IsString()
  @Length(1, 100)
  subjectId!: string;

  @IsEnum(CustomerReportReason)
  reason!: CustomerReportReason;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(3, 1200)
  details?: string;
}
