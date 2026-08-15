import { Transform } from "class-transformer";
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from "class-validator";
import {
  FoundingPaymentBlocker,
  FoundingPaymentInterest,
  FoundingValueRating,
} from "../../../generated/prisma/client";

const trim = ({ value }: { value: unknown }) =>
  typeof value === "string" ? value.trim() : value;

export class SubmitFoundingValueFeedbackDto {
  @IsEnum(FoundingValueRating)
  valueRating!: FoundingValueRating;

  @IsEnum(FoundingPaymentInterest)
  paymentInterest!: FoundingPaymentInterest;

  @ValidateIf((dto: SubmitFoundingValueFeedbackDto) =>
    dto.paymentInterest === FoundingPaymentInterest.NOT_NOW,
  )
  @IsEnum(FoundingPaymentBlocker)
  paymentBlocker?: FoundingPaymentBlocker;

  @Transform(trim)
  @ValidateIf((dto: SubmitFoundingValueFeedbackDto) =>
    dto.paymentInterest === FoundingPaymentInterest.NOT_NOW
    && dto.paymentBlocker === FoundingPaymentBlocker.OTHER,
  )
  @IsString()
  @Length(3, 500)
  paymentBlockerDetail?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  valueNeeded?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  volunteeredPriceAmount?: number;
}
