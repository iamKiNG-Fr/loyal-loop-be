import { IsString, Length } from "class-validator";

export class CreateSupportRequestDto {
  @IsString()
  @Length(1, 100)
  topic!: string;

  @IsString()
  @Length(3, 4000)
  message!: string;
}
