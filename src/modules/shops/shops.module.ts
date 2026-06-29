import { Module } from "@nestjs/common";
import { SalesModule } from "../sales/sales.module";
import {
  CustomerShopController,
  OrderRequestsController,
  PublicShopsController,
} from "./shops.controller";
import { ShopsService } from "./shops.service";

@Module({
  imports: [SalesModule],
  controllers: [
    PublicShopsController,
    CustomerShopController,
    OrderRequestsController,
  ],
  providers: [ShopsService],
})
export class ShopsModule {}
