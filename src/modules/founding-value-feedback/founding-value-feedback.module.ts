import { Module } from "@nestjs/common";
import { FoundingValueFeedbackController } from "./founding-value-feedback.controller";
import { FoundingValueFeedbackService } from "./founding-value-feedback.service";

@Module({
  controllers: [FoundingValueFeedbackController],
  providers: [FoundingValueFeedbackService],
  exports: [FoundingValueFeedbackService],
})
export class FoundingValueFeedbackModule {}
