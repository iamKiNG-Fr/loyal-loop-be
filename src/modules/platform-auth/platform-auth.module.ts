import { Module } from "@nestjs/common";
import { CustomerAuthModule } from "../customer-auth/customer-auth.module";
import { PlatformAuthController } from "./platform-auth.controller";
import { PlatformAuthService } from "./platform-auth.service";

@Module({
  imports: [CustomerAuthModule],
  controllers: [PlatformAuthController],
  providers: [PlatformAuthService],
})
export class PlatformAuthModule {}
