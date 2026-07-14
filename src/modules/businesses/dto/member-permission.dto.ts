import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  ValidateNested,
} from "class-validator";
import { BusinessCapability } from "../../../generated/prisma/client";

export class MemberPermissionOverrideDto {
  @IsEnum(BusinessCapability)
  capability!: BusinessCapability;

  @IsBoolean()
  allowed!: boolean;
}

export class UpdateMemberPermissionsDto {
  @IsArray()
  @ArrayMaxSize(32)
  @ValidateNested({ each: true })
  @Type(() => MemberPermissionOverrideDto)
  overrides!: MemberPermissionOverrideDto[];
}
