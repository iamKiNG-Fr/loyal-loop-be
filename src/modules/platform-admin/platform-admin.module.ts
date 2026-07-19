import { Module } from "@nestjs/common";
import { FoundingCircleModule } from "../founding-circle/founding-circle.module";
import { PlatformAdminController } from "./platform-admin.controller";
import { PlatformAdminService } from "./platform-admin.service";

@Module({
  imports: [FoundingCircleModule],
  controllers: [PlatformAdminController],
  providers: [PlatformAdminService],
})
export class PlatformAdminModule {}
