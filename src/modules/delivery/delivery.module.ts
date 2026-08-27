import { Module } from "@nestjs/common";
import {
  DeliveryController,
  PublicDeliveryController,
} from "./delivery.controller";
import { DeliveryService } from "./delivery.service";
import { FoundingValueFeedbackModule } from "../founding-value-feedback/founding-value-feedback.module";

@Module({
  imports: [FoundingValueFeedbackModule],
  controllers: [DeliveryController, PublicDeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
