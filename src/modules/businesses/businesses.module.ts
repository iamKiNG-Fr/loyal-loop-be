import { Module } from "@nestjs/common";
import {
  BusinessesController,
  PublicTrustCardsController,
} from "./businesses.controller";
import { BusinessesService } from "./businesses.service";

@Module({
  controllers: [BusinessesController, PublicTrustCardsController],
  providers: [BusinessesService],
  exports: [BusinessesService],
})
export class BusinessesModule {}
