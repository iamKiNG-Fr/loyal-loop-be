import { Module } from "@nestjs/common";
import { BusinessesModule } from "../businesses/businesses.module";
import { SalesModule } from "../sales/sales.module";
import { PromotionsModule } from "../promotions/promotions.module";
import {
  CustomerShopController,
  CustomerOrderRequestsController,
  OrderRequestsController,
  PublicShopsController,
} from "./shops.controller";
import { ShopsService } from "./shops.service";

@Module({
  imports: [BusinessesModule, SalesModule, PromotionsModule],
  controllers: [
    PublicShopsController,
    CustomerShopController,
    CustomerOrderRequestsController,
    OrderRequestsController,
  ],
  providers: [ShopsService],
})
export class ShopsModule {}
