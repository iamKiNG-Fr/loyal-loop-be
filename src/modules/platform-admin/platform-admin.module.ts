import { Module } from "@nestjs/common";
import { AdminOriginGuard } from "../../common/auth/admin-origin.guard";
import { FoundingCircleModule } from "../founding-circle/founding-circle.module";
import { FoundingValueFeedbackModule } from "../founding-value-feedback/founding-value-feedback.module";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminService } from "./platform-admin.service";

@Module({
  imports: [FoundingCircleModule, FoundingValueFeedbackModule],
  controllers: [PlatformAdminController],
  providers: [AdminOriginGuard, PlatformAdminService],
})
export class PlatformAdminModule {}
