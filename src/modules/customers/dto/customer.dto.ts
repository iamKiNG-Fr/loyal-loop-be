import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { ContactPlatform, CustomerChannel } from "../../../generated/prisma/client";
import { PaginationDto } from "../../../common/pagination.dto";

export class CustomerContactInputDto {
  @IsEnum(ContactPlatform)
  platform!: ContactPlatform;

  @IsString()
  @Length(1, 240)
  value!: string;
}

export class CreateCustomerDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== "")
  @IsString()
  @Length(0, 30)
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: "phone must be a valid international number",
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  email?: string;

  @IsOptional()
  @IsEnum(CustomerChannel)
  channel?: CustomerChannel;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CustomerContactInputDto)
  contacts?: CustomerContactInputDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tagIds?: string[];
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @ValidateIf((_object, value) => value !== "")
  @IsString()
  @Length(0, 30)
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: "phone must be a valid international number",
  })
  phone?: string;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  email?: string;

  @IsOptional()
  @IsEnum(CustomerChannel)
  channel?: CustomerChannel;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CustomerContactInputDto)
  contacts?: CustomerContactInputDto[];
}

export class CustomerListDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @Length(0, 100)
  query?: string;
}

export class AddCustomerNoteDto {
  @IsString()
  @Length(1, 1000)
  content!: string;
}

export class CreateCustomerTagDto {
  @IsString()
  @Length(1, 60)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 30)
  color?: string;
}

export class AssignCustomerTagsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tagIds!: string[];
}
