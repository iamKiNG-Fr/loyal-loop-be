import { Module } from "@nestjs/common";
import {
  PublicReceiptsController,
  PublicReceiptMediaController,
  ReceiptsController,
} from "./receipts.controller";
import { ReceiptsService } from "./receipts.service";

@Module({
  controllers: [ReceiptsController, PublicReceiptsController, PublicReceiptMediaController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
