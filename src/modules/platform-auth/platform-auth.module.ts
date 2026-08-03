import { Module } from "@nestjs/common";
import { AdminOriginGuard } from "../../common/auth/admin-origin.guard";
import { CustomerAuthModule } from "../customer-auth/customer-auth.module";
import { PlatformAuthController } from "./platform-auth.controller";
import { PlatformAuthService } from "./platform-auth.service";

@Module({
  imports: [CustomerAuthModule],
  controllers: [PlatformAuthController],
  providers: [AdminOriginGuard, PlatformAuthService],
})
export class PlatformAuthModule {}
