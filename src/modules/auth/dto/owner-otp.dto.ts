import { IsString, Matches } from "class-validator";

export class StartOwnerOtpDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/)
  phone!: string;
}

export class VerifyOwnerOtpDto {
  @IsString()
  challengeId!: string;

  @IsString()
  @Matches(/^\d{4,8}$/)
  code!: string;
}
