import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
} from "class-validator";

export class UpsertPaymentAccountDto {
  @IsString()
  @Length(2, 100)
  bankName!: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  bankCode?: string;

  @IsString()
  @Length(2, 120)
  accountName!: string;

  @IsString()
  @Matches(/^\d{6,20}$/)
  accountNumber!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  instructions?: string;
}

export class SubmitPaymentProofDto {
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  amount!: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  reference?: string;

  @IsString()
  publicId!: string;

  @IsUrl({ protocols: ["https"], require_protocol: true })
  secureUrl!: string;

  @IsString()
  format!: string;

  @IsInt()
  @Min(1)
  @Max(5 * 1024 * 1024)
  bytes!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  height?: number;

  @IsString()
  version!: string;

  @IsString()
  signature!: string;

  @IsOptional()
  @IsString()
  originalFilename?: string;
}

export class ReviewPaymentProofDto {
  @IsIn(["VERIFIED", "REJECTED"])
  decision!: "REJECTED" | "VERIFIED";

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}
