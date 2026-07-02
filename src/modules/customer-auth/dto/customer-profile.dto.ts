import { IsString, Length } from "class-validator";

export class UpdateCustomerProfileDto {
  @IsString()
  @Length(2, 100)
  name!: string;
}
