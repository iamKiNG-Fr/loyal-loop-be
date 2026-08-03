import { Global, Module } from "@nestjs/common";
import { CustomerAuthGuard } from "./customer-auth.guard";
import { OwnerAuthGuard } from "./owner-auth.guard";
import { RolesGuard } from "./roles.guard";
import { CapabilitiesGuard } from "./capabilities.guard";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformRolesGuard } from "./platform-roles.guard";
import { CsrfGuard } from "./csrf.guard";
import { CsrfService } from "./csrf.service";
import { SecurityController } from "./security.controller";

@Global()
@Module({
  controllers: [SecurityController],
  providers: [CsrfService, CsrfGuard, OwnerAuthGuard, CustomerAuthGuard, RolesGuard, CapabilitiesGuard, PlatformAdminGuard, PlatformRolesGuard],
  exports: [CsrfService, CsrfGuard, OwnerAuthGuard, CustomerAuthGuard, RolesGuard, CapabilitiesGuard, PlatformAdminGuard, PlatformRolesGuard],
})
export class SecurityModule {}
