import { Module } from "@nestjs/common";
import { FoundingValueFeedbackModule } from "../founding-value-feedback/founding-value-feedback.module";
import { MediaModule } from "../media/media.module";
import {
  PaymentsController,
  PublicDeliveryPaymentsController,
  PublicReceiptPaymentsController,
} from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [MediaModule, FoundingValueFeedbackModule],
  controllers: [
    PaymentsController,
    PublicReceiptPaymentsController,
    PublicDeliveryPaymentsController,
  ],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
