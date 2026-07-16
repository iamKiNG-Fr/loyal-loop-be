import { IsIn } from "class-validator";

export class MessagingConsentDto {
  @IsIn(["RECEIPT", "DELIVERY", "REMINDER"])
  purpose!: "RECEIPT" | "DELIVERY" | "REMINDER";
}
