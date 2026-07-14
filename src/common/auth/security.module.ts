import { Global, Module } from "@nestjs/common";
import { CustomerAuthGuard } from "./customer-auth.guard";
import { OwnerAuthGuard } from "./owner-auth.guard";
import { RolesGuard } from "./roles.guard";
import { CapabilitiesGuard } from "./capabilities.guard";

@Global()
@Module({
  providers: [OwnerAuthGuard, CustomerAuthGuard, RolesGuard, CapabilitiesGuard],
  exports: [OwnerAuthGuard, CustomerAuthGuard, RolesGuard, CapabilitiesGuard],
})
export class SecurityModule {}
