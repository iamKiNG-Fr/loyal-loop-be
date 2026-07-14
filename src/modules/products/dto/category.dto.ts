import { IsObject, IsOptional, IsString, Length } from "class-validator";

export class CreateBusinessCategoryDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  templateKey?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;
}
