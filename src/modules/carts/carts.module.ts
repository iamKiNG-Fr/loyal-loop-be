import { Module } from "@nestjs/common";
import { CartsService } from "./carts.service";
import { CustomerCartController, DeviceCartController } from "./carts.controller";
import { PromotionsModule } from "../promotions/promotions.module";

@Module({
  imports: [PromotionsModule],
  controllers: [CustomerCartController, DeviceCartController],
  providers: [CartsService],
  exports: [CartsService],
})
export class CartsModule {}
