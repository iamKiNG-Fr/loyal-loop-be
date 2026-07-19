import { Global, Module } from "@nestjs/common";
import { CustomerAuthGuard } from "./customer-auth.guard";
import { OwnerAuthGuard } from "./owner-auth.guard";
import { RolesGuard } from "./roles.guard";
import { CapabilitiesGuard } from "./capabilities.guard";
import { PlatformAdminGuard } from "./platform-admin.guard";
import { PlatformRolesGuard } from "./platform-roles.guard";

@Global()
@Module({
  providers: [OwnerAuthGuard, CustomerAuthGuard, RolesGuard, CapabilitiesGuard, PlatformAdminGuard, PlatformRolesGuard],
  exports: [OwnerAuthGuard, CustomerAuthGuard, RolesGuard, CapabilitiesGuard, PlatformAdminGuard, PlatformRolesGuard],
})
export class SecurityModule {}
