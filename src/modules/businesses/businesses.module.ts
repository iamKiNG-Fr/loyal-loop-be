import { Module } from "@nestjs/common";
import { CustomerAuthModule } from "../customer-auth/customer-auth.module";
import {
  BusinessesController,
  PublicTrustCardsController,
} from "./businesses.controller";
import { BusinessesService } from "./businesses.service";

@Module({
  imports: [CustomerAuthModule],
  controllers: [BusinessesController, PublicTrustCardsController],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
