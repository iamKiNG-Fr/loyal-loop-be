import { IsEnum, IsOptional, IsString, Length } from "class-validator";
import { SupportRequestKind } from "../../../generated/prisma/client";

export class CreateSupportRequestDto {
  @IsString()
  @Length(1, 100)
  topic!: string;

  @IsString()
  @Length(3, 4000)
  message!: string;

  // FEEDBACK is an idea or reaction for the Loyal Loop team, not a request
  // that needs a reply. Defaults to SUPPORT so existing callers are unchanged.
  @IsOptional()
  @IsEnum(SupportRequestKind)
  kind?: SupportRequestKind;
}
