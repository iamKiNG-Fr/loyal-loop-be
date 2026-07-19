import { IsString, Length, Matches } from "class-validator";

export class VerifyPlatformStepUpDto {
  @IsString()
  @Length(1, 120)
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
