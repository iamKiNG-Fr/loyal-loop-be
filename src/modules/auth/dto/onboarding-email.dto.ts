import { IsEmail, IsString, Length, Matches } from "class-validator";

export class StartOnboardingEmailDto {
  @IsEmail()
  @Length(3, 254)
  email!: string;
}

export class VerifyOnboardingEmailDto {
  @IsString()
  @Length(1, 120)
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
