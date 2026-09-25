import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Matches, Max, Min } from "class-validator";

export class RentalPhotoDto {
  @IsString()
  publicId!: string;

  @IsUrl({ protocols: ["https"], require_protocol: true })
  secureUrl!: string;

  @IsIn(["authenticated"])
  deliveryType!: "authenticated";

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

export class ReturnRentalDto extends RentalPhotoDto {
  @IsBoolean()
  applyLateFee!: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  expectedLateFee?: string;
}
