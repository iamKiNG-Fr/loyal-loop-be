import { Module } from "@nestjs/common";
import { PlatformAdminGuard } from "../../common/auth/platform-admin.guard";
import { PlatformRolesGuard } from "../../common/auth/platform-roles.guard";
import {
  MediaController,
  MediaModerationController,
  MediaWebhookController,
} from "./media.controller";
import { MediaService } from "./media.service";

@Module({
  controllers: [MediaController, MediaModerationController, MediaWebhookController],
  providers: [MediaService, PlatformAdminGuard, PlatformRolesGuard],
  exports: [MediaService],
})
export class MediaModule {}
