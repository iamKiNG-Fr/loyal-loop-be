import {
  IsEmail,
  IsEnum,
  IsString,
  Length,
} from "class-validator";
import { BusinessRole } from "../../../generated/prisma/client";

export class CreateBusinessInvitationDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsEmail()
  email!: string;

  @IsEnum(BusinessRole)
  role!: BusinessRole;
}

export class AcceptBusinessInvitationDto {
  @IsString()
  token!: string;
}
