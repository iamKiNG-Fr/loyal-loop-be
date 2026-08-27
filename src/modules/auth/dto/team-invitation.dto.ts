import { IsString, Length, MinLength } from "class-validator";

export class TeamInvitationTokenDto {
  @IsString()
  @Length(20, 300)
  token!: string;
}

export class RegisterTeamInvitationDto extends TeamInvitationTokenDto {
  @IsString()
  @MinLength(8)
  @Length(8, 128)
  password!: string;
}
