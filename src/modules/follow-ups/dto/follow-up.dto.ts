import {
  IsDateString,
  IsOptional,
  IsString,
  Length,
} from "class-validator";

export class CreateFollowUpTemplateDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsString()
  @Length(1, 2000)
  body!: string;
}

export class CreateFollowUpSuggestionDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsString()
  @Length(1, 500)
  reason!: string;

  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
