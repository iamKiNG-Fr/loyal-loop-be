import { Module } from "@nestjs/common";
import {
  PublicReceiptsController,
  ReceiptsController,
} from "./receipts.controller";
import { ReceiptsService } from "./receipts.service";

@Module({
  controllers: [ReceiptsController, PublicReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
