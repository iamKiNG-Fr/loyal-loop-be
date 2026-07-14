import { IsIn } from "class-validator";

export class MessagingConsentDto {
  @IsIn(["RECEIPT", "DELIVERY"])
  purpose!: "RECEIPT" | "DELIVERY";
}

