import { Module } from "@nestjs/common";
import { FoundingValueFeedbackModule } from "../founding-value-feedback/founding-value-feedback.module";
import { SalesController } from "./sales.controller";
import { SalesService } from "./sales.service";

@Module({
  imports: [FoundingValueFeedbackModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
