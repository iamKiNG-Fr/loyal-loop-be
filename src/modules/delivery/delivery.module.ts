import { Module } from "@nestjs/common";
import {
  DeliveryController,
  PublicDeliveryController,
} from "./delivery.controller";
import { DeliveryService } from "./delivery.service";

@Module({
  controllers: [DeliveryController, PublicDeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
