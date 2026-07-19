import { Module } from "@nestjs/common";
import { FoundingCircleController } from "./founding-circle.controller";
import { FoundingCircleService } from "./founding-circle.service";

@Module({
  controllers: [FoundingCircleController],
  providers: [FoundingCircleService],
  exports: [FoundingCircleService],
})
export class FoundingCircleModule {}
