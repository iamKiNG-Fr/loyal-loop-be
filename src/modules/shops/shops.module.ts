import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module";
import { SalesModule } from "../sales/sales.module";
import {
  CustomerShopController,
  CustomerOrderRequestsController,
  OrderRequestsController,
  PublicShopsController,
} from "./shops.controller";
import { ShopsService } from "./shops.service";

@Module({
  imports: [BusinessesModule, SalesModule],
  controllers: [
    PublicShopsController,
    CustomerShopController,
    CustomerOrderRequestsController,
    OrderRequestsController,
  ],
  providers: [ShopsService],
})
export class ShopsModule {}
