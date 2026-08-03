import { Global, Module } from "@nestjs/common";
import { AttentionSchedulerService } from "./attention-scheduler.service";
import { AttentionController, AttentionSchedulerController } from "./attention.controller";
import { AttentionService } from "./attention.service";
import { WebPushService } from "./web-push.service";

@Global()
@Module({
  controllers: [AttentionController, AttentionSchedulerController],
  providers: [AttentionService, AttentionSchedulerService, WebPushService],
  exports: [AttentionService, AttentionSchedulerService],
})
export class AttentionModule {}
