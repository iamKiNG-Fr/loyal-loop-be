import { IsObject, IsOptional, IsString, Length, Matches } from "class-validator";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

export class PlatformAdminIdentifierDto {
  @IsString()
  @Length(3, 254)
  @Matches(/^(?:[^\s@]+@[^\s@]+\.[^\s@]+|\+?[0-9][0-9\s()-]{7,20})$/)
  identifier!: string;
}

export class VerifyPlatformStepUpDto {
  @IsString()
  @Length(1, 120)
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class VerifyPasskeyRegistrationDto {
  @IsString()
  @Length(1, 120)
  challengeId!: string;

  @IsObject()
  response!: RegistrationResponseJSON;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;
}

export class VerifyPasskeyAuthenticationDto {
  @IsString()
  @Length(1, 120)
  challengeId!: string;

  @IsObject()
  response!: AuthenticationResponseJSON;
}

export class VerifyPlatformRecoveryCodeDto {
  @IsString()
  @Matches(/^LL-[A-Z0-9]{8}-[A-Z0-9]{8}$/i)
  code!: string;
}

export class RenamePasskeyDto {
  @IsString()
  @Length(1, 80)
  name!: string;
}
