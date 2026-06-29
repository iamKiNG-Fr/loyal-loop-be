import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from "class-validator";
import { WorkspaceAppearance } from "../../../generated/prisma/client";

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  phone?: string;

  @IsOptional()
  @IsEnum(WorkspaceAppearance)
  workspaceAppearance?: WorkspaceAppearance;
}
