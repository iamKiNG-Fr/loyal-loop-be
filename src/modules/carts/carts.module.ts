import { Module } from "@nestjs/common";
import { CartsService } from "./carts.service";
import { CustomerCartController, DeviceCartController } from "./carts.controller";

@Module({
  controllers: [CustomerCartController, DeviceCartController],
  providers: [CartsService],
  exports: [CartsService],
})
export class CartsModule {}
